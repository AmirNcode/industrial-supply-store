"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  categoryNodeKey,
  moveSibling,
  parseTaxonomyNodeKey,
  reconcileSiblingOrder,
  setVisibilityDraft,
  sameOrder,
  type AdminTaxonomyNode,
  type TaxonomyNodeKey,
  type TaxonomyVisibilityDraft,
} from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  createTaxonomyNodeAction,
  saveTaxonomyWorkbenchAction,
  type TaxonomyCreateResult,
  type TaxonomySaveResult,
} from "./actions";
import { DeleteControl } from "./DeleteControl";
import { FamilyImportControl } from "./FamilyImportControl";
import { UnsavedOrderGuard } from "./UnsavedOrderGuard";

type OrderMap = Record<string, number[]>;
type ContentEdit = { aboutEn: string; aboutFa: string; file?: File };
type ContentMap = Record<TaxonomyNodeKey, ContentEdit>;
type Adding = { kind: "category" | "family"; parentId: number | null };
type MediaEditor = { key: TaxonomyNodeKey; description: string; file?: File };

const rootScope = "root";
const scopeKey = (parentId: number | null) => parentId === null ? rootScope : String(parentId);

function nodeName(node: AdminTaxonomyNode, locale: Locale): string {
  return locale === "fa" ? node.nameFa || node.nameEn : node.nameEn;
}

function sorted(nodes: AdminTaxonomyNode[]): AdminTaxonomyNode[] {
  return [...nodes].sort((a, b) => a.sort - b.sort || a.id - b.id);
}

export function TaxonomyWorkbench({
  nodes,
  locale,
  demo,
}: {
  nodes: AdminTaxonomyNode[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const searchParams = useSearchParams();

  const model = useMemo(() => {
    const byKey = new Map<TaxonomyNodeKey, AdminTaxonomyNode>();
    const categoriesById = new Map<number, AdminTaxonomyNode>();
    const categoryChildren = new Map<string, AdminTaxonomyNode[]>();
    const familyChildren = new Map<number, AdminTaxonomyNode[]>();

    for (const node of nodes) {
      byKey.set(node.key, node);
      if (node.kind === "category") {
        categoriesById.set(node.id, node);
        const key = scopeKey(node.parentId);
        categoryChildren.set(key, [...(categoryChildren.get(key) ?? []), node]);
      } else if (node.parentId !== null) {
        familyChildren.set(node.parentId, [...(familyChildren.get(node.parentId) ?? []), node]);
      }
    }
    for (const [key, children] of categoryChildren) categoryChildren.set(key, sorted(children));
    for (const [key, children] of familyChildren) familyChildren.set(key, sorted(children));

    const categoryOrders: OrderMap = {};
    const familyOrders: OrderMap = {};
    for (const [key, children] of categoryChildren) {
      categoryOrders[key] = children.map((node) => node.id);
    }
    for (const [key, children] of familyChildren) {
      familyOrders[String(key)] = children.map((node) => node.id);
    }
    const first = categoryChildren.get(rootScope)?.[0] ?? nodes[0] ?? null;
    return {
      byKey,
      categoriesById,
      categoryChildren,
      familyChildren,
      categoryOrders,
      familyOrders,
      first,
    };
  }, [nodes]);

  const urlSelection = parseTaxonomyNodeKey(searchParams.get("cat"));
  const selectedKey =
    urlSelection && model.byKey.has(urlSelection) ? urlSelection : model.first?.key ?? null;
  const [expansion, setExpansion] = useState<Partial<Record<TaxonomyNodeKey, boolean>>>({});
  const [search, setSearch] = useState("");
  const [arrange, setArrange] = useState(false);
  const [categoryOrders, setCategoryOrders] = useState<OrderMap>({});
  const [familyOrders, setFamilyOrders] = useState<OrderMap>({});
  const [content, setContent] = useState<ContentMap>({});
  const [visibility, setVisibility] = useState<TaxonomyVisibilityDraft>({});
  const [adding, setAdding] = useState<Adding | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<TaxonomyCreateResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MediaEditor | null>(null);
  const [openFamilyDetails, setOpenFamilyDetails] = useState<Set<TaxonomyNodeKey>>(
    () => new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<TaxonomySaveResult | null>(null);

  const selected =
    (selectedKey ? model.byKey.get(selectedKey) : undefined) ?? model.first;

  function ancestorsFor(node: AdminTaxonomyNode): AdminTaxonomyNode[] {
    const ancestors: AdminTaxonomyNode[] = [];
    let parentId = node.kind === "family" ? node.parentId : node.parentId;
    while (parentId !== null) {
      const parent = model.categoriesById.get(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      parentId = parent.parentId;
    }
    return ancestors;
  }

  function updateUrl(key: TaxonomyNodeKey, mode: "push" | "replace" = "push") {
    const url = new URL(window.location.href);
    url.searchParams.set("cat", key);
    window.history[mode === "push" ? "pushState" : "replaceState"](
      null,
      "",
      url.pathname + url.search + url.hash,
    );
  }

  function selectNode(key: TaxonomyNodeKey, mode: "push" | "replace" = "push") {
    setAdding(null);
    setEditing(null);
    setCreateError(null);
    if (key !== selectedKey || mode === "replace") updateUrl(key, mode);
    const node = model.byKey.get(key);
    if (!node) return;
    setExpansion((previous) => {
      const next = { ...previous };
      for (const ancestor of ancestorsFor(node)) next[ancestor.key] = true;
      if (node.kind === "category") next[node.key] = true;
      return next;
    });
  }

  // Ensure even the default pane has a durable URL. This synchronises an
  // external system (browser history) and does not mirror props into state.
  useEffect(() => {
    if (!selected) return;
    if (!urlSelection || !model.byKey.has(urlSelection)) updateUrl(selected.key, "replace");
  }, [selected, urlSelection, model.byKey]);

  // Back/Forward changes selection through `useSearchParams`; close transient
  // editors from the history event without maintaining a second selection.
  useEffect(() => {
    const onPopState = () => {
      setAdding(null);
      setEditing(null);
      setCreateError(null);
      setSearch("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // A create/import refresh can change membership while a sibling order is
  // dirty. Reconcile as derived state: no prop-to-state effect and no stale id
  // can reach Save.
  const activeCategoryOrders = useMemo(
    () => reconcileOrderMap(categoryOrders, model.categoryOrders),
    [categoryOrders, model.categoryOrders],
  );
  const activeFamilyOrders = useMemo(
    () => reconcileOrderMap(familyOrders, model.familyOrders),
    [familyOrders, model.familyOrders],
  );

  const orderedCategories = (parentId: number | null): AdminTaxonomyNode[] => {
    const key = scopeKey(parentId);
    const server = model.categoryChildren.get(key) ?? [];
    const order = activeCategoryOrders[key];
    if (!order) return server;
    const byId = new Map(server.map((node) => [node.id, node]));
    return order.map((id) => byId.get(id)).filter((node): node is AdminTaxonomyNode => Boolean(node));
  };

  const orderedFamilies = (categoryId: number): AdminTaxonomyNode[] => {
    const server = model.familyChildren.get(categoryId) ?? [];
    const order = activeFamilyOrders[String(categoryId)];
    if (!order) return server;
    const byId = new Map(server.map((node) => [node.id, node]));
    return order.map((id) => byId.get(id)).filter((node): node is AdminTaxonomyNode => Boolean(node));
  };

  function moveCategory(node: AdminTaxonomyNode, by: -1 | 1) {
    const key = scopeKey(node.parentId);
    const server = model.categoryOrders[key] ?? [];
    const next = moveSibling(activeCategoryOrders[key] ?? server, node.id, by);
    setCategoryOrders((previous) => {
      const updated = { ...previous };
      if (sameOrder(next, server)) delete updated[key];
      else updated[key] = next;
      return updated;
    });
    setSaveResult(null);
  }

  function moveFamily(node: AdminTaxonomyNode, by: -1 | 1) {
    if (node.parentId === null) return;
    const key = String(node.parentId);
    const server = model.familyOrders[key] ?? [];
    const next = moveSibling(activeFamilyOrders[key] ?? server, node.id, by);
    setFamilyOrders((previous) => {
      const updated = { ...previous };
      if (sameOrder(next, server)) delete updated[key];
      else updated[key] = next;
      return updated;
    });
    setSaveResult(null);
  }

  function effectiveContent(node: AdminTaxonomyNode): ContentEdit {
    return content[node.key] ?? { aboutEn: node.aboutEn, aboutFa: node.aboutFa };
  }

  function setNodeContent(node: AdminTaxonomyNode, next: ContentEdit) {
    setContent((previous) => {
      const updated = { ...previous };
      if (!next.file && next.aboutEn === node.aboutEn && next.aboutFa === node.aboutFa) {
        delete updated[node.key];
      } else updated[node.key] = next;
      return updated;
    });
    setSaveResult(null);
  }

  function changeDescription(node: AdminTaxonomyNode, value: string) {
    const current = effectiveContent(node);
    setNodeContent(node, {
      ...current,
      ...(locale === "fa" ? { aboutFa: value } : { aboutEn: value }),
    });
  }

  function changeImage(node: AdminTaxonomyNode, file: File | undefined) {
    const current = effectiveContent(node);
    setNodeContent(node, { ...current, file });
  }

  function effectiveVisibility(node: AdminTaxonomyNode): boolean {
    return visibility[node.key] ?? node.isVisible;
  }

  function toggleVisibility(node: AdminTaxonomyNode) {
    const next = !effectiveVisibility(node);
    setVisibility((previous) => setVisibilityDraft(
      previous,
      node.key,
      node.isVisible,
      next,
    ));
    setSaveResult(null);
  }

  function startMediaEdit(node: AdminTaxonomyNode) {
    const current = effectiveContent(node);
    setEditing({
      key: node.key,
      description: locale === "fa" ? current.aboutFa : current.aboutEn,
      file: current.file,
    });
    setAdding(null);
  }

  function commitMediaEdit(node: AdminTaxonomyNode) {
    if (!editing || editing.key !== node.key) return;
    const current = effectiveContent(node);
    setNodeContent(node, {
      ...current,
      ...(locale === "fa"
        ? { aboutFa: editing.description }
        : { aboutEn: editing.description }),
      file: editing.file,
    });
    setEditing(null);
  }

  const dirtyCount =
    Object.keys(activeCategoryOrders).length +
    Object.keys(activeFamilyOrders).length +
    Object.keys(content).length +
    Object.keys(visibility).length;

  function discardAll() {
    setCategoryOrders({});
    setFamilyOrders({});
    setContent({});
    setVisibility({});
    setEditing(null);
    setArrange(false);
    setSaveResult(null);
  }

  async function saveAll(): Promise<boolean> {
    if (saving || dirtyCount === 0) return dirtyCount === 0;
    setSaving(true);
    setSaveResult(null);
    try {
      const orders = [
        ...Object.entries(activeCategoryOrders).map(([scope, orderedIds]) => ({
          kind: "category" as const,
          parentId: scope === rootScope ? null : Number(scope),
          orderedIds,
        })),
        ...Object.entries(activeFamilyOrders).map(([scope, orderedIds]) => ({
          kind: "family" as const,
          parentId: Number(scope),
          orderedIds,
        })),
      ];
      const formData = new FormData();
      formData.set("locale", locale);
      const submittedContent = Object.entries(content).map(([key, edit], index) => {
        const node = model.byKey.get(key as TaxonomyNodeKey);
        if (!node) return null;
        if (edit.file) formData.set(`image_${index}`, edit.file);
        return {
          kind: node.kind,
          id: node.id,
          aboutEn: edit.aboutEn,
          aboutFa: edit.aboutFa,
          ...(edit.file ? { imageIndex: index } : {}),
        };
      }).filter((edit) => edit !== null);
      const submittedVisibility = Object.entries(visibility).map(([key, isVisible]) => {
        const node = model.byKey.get(key as TaxonomyNodeKey);
        if (!node) return null;
        return { kind: node.kind, id: node.id, isVisible };
      }).filter((edit) => edit !== null);
      formData.set("payload", JSON.stringify({
        orders,
        content: submittedContent,
        visibility: submittedVisibility,
      }));

      const result = await saveTaxonomyWorkbenchAction(formData);
      setSaveResult(result);
      if (result !== "saved") return false;
      discardAll();
      setSaveResult("saved");
      router.refresh();
      return true;
    } catch {
      setSaveResult("stale");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createNode() {
    if (!adding || creating || !newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createTaxonomyNodeAction({
        kind: adding.kind,
        parentId: adding.parentId,
        name: newName,
        locale,
      });
      setCreateError(result);
      if (result.kind === "created") {
        setSearch("");
        if (adding.parentId !== null) {
          setExpansion((previous) => ({
            ...previous,
            [categoryNodeKey(adding.parentId!)]: true,
          }));
        }
        setAdding(null);
        setNewName("");
        if (result.selectionKey !== selectedKey) updateUrl(result.selectionKey);
        router.refresh();
      }
    } catch {
      setCreateError({ kind: "error", message: "no-parent" });
    } finally {
      setCreating(false);
    }
  }

  const searchNeedle = search.trim().toLocaleLowerCase(locale);
  const matching = useMemo(() => {
    if (!searchNeedle) return null;
    const keys = new Set<TaxonomyNodeKey>();
    for (const node of nodes) {
      const haystack = `${node.nameEn} ${node.nameFa} ${node.path}`.toLocaleLowerCase(locale);
      if (!haystack.includes(searchNeedle)) continue;
      keys.add(node.key);
      let parentId = node.parentId;
      while (parentId !== null) {
        const parent = model.categoriesById.get(parentId);
        if (!parent) break;
        keys.add(parent.key);
        parentId = parent.parentId;
      }
    }
    return keys;
  }, [searchNeedle, nodes, locale, model.categoriesById]);

  const selectedPathKeys = new Set<TaxonomyNodeKey>();
  if (selected) {
    for (const ancestor of ancestorsFor(selected)) selectedPathKeys.add(ancestor.key);
    if (selected.kind === "category") selectedPathKeys.add(selected.key);
  }

  const treeRows: AdminTaxonomyNode[] = [];
  const addBranch = (category: AdminTaxonomyNode) => {
    if (matching && !matching.has(category.key)) return;
    treeRows.push(category);
    const isOpen =
      matching !== null ||
      (expansion[category.key] ?? selectedPathKeys.has(category.key));
    if (!isOpen) return;
    for (const child of orderedCategories(category.id)) addBranch(child);
    for (const family of orderedFamilies(category.id)) {
      if (!matching || matching.has(family.key)) treeRows.push(family);
    }
  };
  for (const root of orderedCategories(null)) addBranch(root);

  if (!selected) {
    return (
      <div className="taxonomy-empty-page">
        <p>{t.taxonomyNoCategories}</p>
        <button
          type="button"
          className="taxonomy-add-root"
          disabled={demo}
          onClick={() => {
            setAdding({ kind: "category", parentId: null });
            setNewName("");
          }}
        >
          + {t.taxonomyCategory}
        </button>
        {adding && (
          <CreateForm
            label={t.taxonomyNewCategory}
            hint={t.taxonomyTopLevel}
            value={newName}
            pending={creating}
            locale={locale}
            onChange={setNewName}
            onSubmit={createNode}
            onCancel={() => setAdding(null)}
          />
        )}
      </div>
    );
  }

  const selectedAncestors = ancestorsFor(selected);
  const selectedCategoryChildren =
    selected.kind === "category" ? orderedCategories(selected.id) : [];
  const selectedFamilies =
    selected.kind === "category" ? orderedFamilies(selected.id) : [];
  const hasSubcategories = selectedCategoryChildren.length > 0;
  const hasFamilies = selectedFamilies.length > 0;
  const canAddSubcategory = selected.kind === "category" && !hasFamilies;
  const canAddFamily = selected.kind === "category" && !hasSubcategories;
  const currentContent = effectiveContent(selected);
  const currentDescription =
    locale === "fa" ? currentContent.aboutFa || currentContent.aboutEn : currentContent.aboutEn;
  const kindLabel =
    selected.kind === "family"
      ? t.taxonomyProductFamily
      : selected.depth === 0
        ? t.taxonomyCategory
        : t.taxonomySubcategory;
  const createMessage = createError?.kind === "error"
    ? createErrorText(createError.message, t)
    : null;
  const saveMessage = saveResult && saveResult !== "saved"
    ? saveErrorText(saveResult, t)
    : null;

  return (
    <div className="taxonomy-card">
      <UnsavedOrderGuard
        dirtyCount={dirtyCount}
        locale={locale}
        onSave={saveAll}
        onDiscard={discardAll}
        copy={{
          title: t.taxonomyUnsavedTitle,
          body: t.taxonomyUnsavedBody,
          scope: dirtyCount === 1
            ? t.taxonomyPendingOne
            : t.taxonomyPendingMany.replace("{n}", formatInt(dirtyCount, locale)),
        }}
      />

      <div className="taxonomy-mobile-picker">
        <label htmlFor="taxonomy-node-picker">{t.taxonomyChooseNode}</label>
        <select
          id="taxonomy-node-picker"
          className="admin-select"
          value={selected.key}
          onChange={(event) => selectNode(event.target.value as TaxonomyNodeKey)}
        >
          {nodes
            .slice()
            .sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind))
            .map((node) => (
              <option key={node.key} value={node.key}>
                {`${"— ".repeat(node.depth)}${nodeName(node, locale)}${node.kind === "family" ? ` · ${t.taxonomyFamilyTag}` : ""}`}
              </option>
            ))}
        </select>
      </div>

      <div className="taxonomy-body">
        <aside className="taxonomy-rail" aria-label={t.taxonomyTreeLabel}>
          <div className="taxonomy-rail-tools">
            <label className="taxonomy-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.taxonomyFindCategory}
                aria-label={t.taxonomyFindCategory}
              />
            </label>
            <button
              type="button"
              className={`taxonomy-arrange-toggle ${arrange ? "is-active" : ""}`}
              disabled={demo}
              onClick={() => {
                if (!arrange) setSearch("");
                setArrange((value) => !value);
              }}
            >
              {arrange ? t.taxonomyDone : t.taxonomyArrange}
            </button>
          </div>

          <div className="taxonomy-tree">
            {treeRows.map((node) => {
              const categoryChildren =
                node.kind === "category" ? orderedCategories(node.id) : [];
              const familyChildren =
                node.kind === "category" ? orderedFamilies(node.id) : [];
              const hasChildren = categoryChildren.length + familyChildren.length > 0;
              const siblings = node.kind === "category"
                ? orderedCategories(node.parentId)
                : orderedFamilies(node.parentId!);
              const position = siblings.findIndex((sibling) => sibling.id === node.id);
              const isVisible = effectiveVisibility(node);
              return (
                <div
                  key={node.key}
                  className={`taxonomy-tree-row ${selected.key === node.key ? "is-selected" : ""} ${node.kind === "family" ? "is-family" : ""} ${node.depth === 0 ? "is-root" : ""}`}
                  style={{ paddingInlineStart: `${10 + node.depth * 16}px` }}
                >
                  {node.kind === "category" && hasChildren ? (
                    <button
                      type="button"
                      className={`taxonomy-caret ${(
                        expansion[node.key] ?? selectedPathKeys.has(node.key)
                      ) ? "is-open" : ""}`}
                      aria-label={(expansion[node.key] ?? selectedPathKeys.has(node.key))
                        ? t.taxonomyCollapse
                        : t.taxonomyExpand}
                      aria-expanded={expansion[node.key] ?? selectedPathKeys.has(node.key)}
                      onClick={() => {
                        const isOpen = expansion[node.key] ?? selectedPathKeys.has(node.key);
                        setExpansion((previous) => ({ ...previous, [node.key]: !isOpen }));
                      }}
                    />
                  ) : <span className="taxonomy-caret-space" />}
                  <button
                    type="button"
                    className="taxonomy-node-name"
                    onClick={() => selectNode(node.key)}
                  >
                    {nodeName(node, locale)}
                  </button>
                  {node.kind === "family" && (
                    <span className="taxonomy-family-tag">{t.taxonomyFamilyTag}</span>
                  )}
                  <span className="taxonomy-tree-count">
                    {node.kind === "category"
                      ? node.familyCount > 0
                        ? `${formatInt(node.familyCount, locale)} · ${formatInt(node.productCount, locale)}`
                        : "0"
                      : formatInt(node.productCount, locale)}
                  </span>
                  {arrange && (
                    <span className="taxonomy-move-buttons">
                      <VisibilityButton
                        visible={isVisible}
                        name={nodeName(node, locale)}
                        locale={locale}
                        disabled={demo}
                        onToggle={() => toggleVisibility(node)}
                      />
                      <button
                        type="button"
                        disabled={demo || position <= 0}
                        aria-label={t.columnsMoveUp}
                        onClick={() => node.kind === "category" ? moveCategory(node, -1) : moveFamily(node, -1)}
                      >↑</button>
                      <button
                        type="button"
                        disabled={demo || position < 0 || position === siblings.length - 1}
                        aria-label={t.columnsMoveDown}
                        onClick={() => node.kind === "category" ? moveCategory(node, 1) : moveFamily(node, 1)}
                      >↓</button>
                    </span>
                  )}
                </div>
              );
            })}
            {treeRows.length === 0 && (
              <p className="taxonomy-search-empty">{t.taxonomyNoMatches}</p>
            )}
          </div>

          <button
            type="button"
            className="taxonomy-add-root"
            disabled={demo}
            onClick={() => {
              setAdding({ kind: "category", parentId: null });
              setNewName("");
              setCreateError(null);
              setEditing(null);
            }}
          >
            + {t.taxonomyCategory}
          </button>
        </aside>

        <main className="taxonomy-pane">
          <div className="taxonomy-breadcrumb tech">
            <span>{t.taxonomyAllCategories}</span>
            {selectedAncestors.map((ancestor) => (
              <span key={ancestor.key}> / {nodeName(ancestor, locale)}</span>
            ))}
            <span> /</span>
          </div>

          <div className="taxonomy-title-row">
            <h1>{nodeName(selected, locale)}</h1>
            <span className="taxonomy-kind-chip">{kindLabel}</span>
            <span className="taxonomy-title-meta tech">
              {selected.kind === "category"
                ? t.taxonomyCategoryMeta
                    .replace("{families}", formatInt(selected.familyCount, locale))
                    .replace("{products}", formatInt(selected.productCount, locale))
                : t.taxonomyFamilyMeta
                    .replace("{products}", formatInt(selected.productCount, locale))
                    .replace("{imported}", selected.productCount > 0 ? t.taxonomyImportUnknown : t.taxonomyNeverImported)}
            </span>
            <div className="taxonomy-title-actions">
              <button
                type="button"
                className="taxonomy-ghost-button"
                disabled={demo}
                onClick={() => startMediaEdit(selected)}
              >
                {t.taxonomyEditImageText}
              </button>
              {selected.kind === "category" && (
                <>
                  <button
                    type="button"
                    className="taxonomy-ghost-button"
                    disabled={demo || !canAddSubcategory}
                    title={!canAddSubcategory ? t.taxonomySubcategoryBlockedTitle : undefined}
                    onClick={() => {
                      setAdding({ kind: "category", parentId: selected.id });
                      setNewName("");
                      setCreateError(null);
                      setEditing(null);
                    }}
                  >
                    {t.taxonomyAddSubcategory}
                  </button>
                  <button
                    type="button"
                    className="taxonomy-ghost-button"
                    disabled={demo || !canAddFamily}
                    title={!canAddFamily ? t.taxonomyFamilyBlockedTitle : undefined}
                    onClick={() => {
                      setAdding({ kind: "family", parentId: selected.id });
                      setNewName("");
                      setCreateError(null);
                      setEditing(null);
                    }}
                  >
                    {t.taxonomyAddFamily}
                  </button>
                </>
              )}
            </div>
          </div>

          {selected.kind === "category" && (hasSubcategories || hasFamilies) && (
            <p className="taxonomy-rule-banner">
              {hasSubcategories
                ? t.taxonomyRuleHasSubcategories.replace("{name}", nodeName(selected, locale))
                : t.taxonomyRuleHasFamilies.replace("{name}", nodeName(selected, locale))}
            </p>
          )}

          {adding && (
            <CreateForm
              label={adding.kind === "family"
                ? t.taxonomyNewFamily
                : adding.parentId === null
                  ? t.taxonomyNewCategory
                  : t.taxonomyNewSubcategory}
              hint={adding.parentId === null
                ? t.taxonomyTopLevel
                : t.taxonomyUnder.replace(
                    "{parent}",
                    nodeName(model.categoriesById.get(adding.parentId) ?? selected, locale),
                  )}
              value={newName}
              pending={creating}
              locale={locale}
              error={createMessage}
              onChange={setNewName}
              onSubmit={createNode}
              onCancel={() => {
                setAdding(null);
                setCreateError(null);
              }}
            />
          )}

          {editing?.key === selected.key ? (
            <MediaEditorPanel
              node={selected}
              locale={locale}
              value={editing.description}
              file={editing.file}
              pending={saving}
              onChange={(description) => setEditing({ ...editing, description })}
              onFile={(file) => setEditing({ ...editing, file })}
              onSave={() => commitMediaEdit(selected)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <MediaStrip
              node={selected}
              locale={locale}
              description={currentDescription}
              file={currentContent.file}
              demo={demo}
              pendingChanges={dirtyCount > 0}
              onEdit={() => startMediaEdit(selected)}
            />
          )}

          {saveMessage && <p className="taxonomy-error-banner">{saveMessage}</p>}
          {saveResult === "saved" && <p className="taxonomy-success-banner">{t.taxonomySaved}</p>}

          {selected.kind === "family" ? (
            <SelectedFamilyPane node={selected} ancestors={selectedAncestors} locale={locale} demo={demo} />
          ) : hasSubcategories ? (
            <section className="taxonomy-section">
              <div className="taxonomy-section-heading">
                <h2>{t.taxonomySubcategories}</h2>
                <span className="tech">{t.taxonomySubcategoriesHint}</span>
              </div>
              <div>
                {selectedCategoryChildren.map((child, index) => (
                  <div key={child.key} className="taxonomy-child-row">
                    <button type="button" onClick={() => selectNode(child.key)}>
                      {nodeName(child, locale)}
                    </button>
                    <span className="tech taxonomy-child-meta">
                      {t.taxonomyCategoryMeta
                        .replace("{families}", formatInt(child.familyCount, locale))
                        .replace("{products}", formatInt(child.productCount, locale))}
                    </span>
                    {child.familyCount === 0 && (
                      <span className="tech taxonomy-no-family-note">{t.taxonomyNoFamiliesNote}</span>
                    )}
                    <span className="taxonomy-row-end">
                      <button
                        type="button"
                        className="taxonomy-ghost-button"
                        onClick={() => selectNode(child.key)}
                      >{t.taxonomyOpen}</button>
                      {arrange && (
                        <MoveButtons
                          index={index}
                          length={selectedCategoryChildren.length}
                          locale={locale}
                          disabled={demo}
                          onMove={(by) => moveCategory(child, by)}
                        />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <FamiliesPane
              category={selected}
              families={selectedFamilies}
              locale={locale}
              demo={demo}
              arrange={arrange}
              openDetails={openFamilyDetails}
              effectiveContent={effectiveContent}
              onArrange={() => {
                if (!arrange) setSearch("");
                setArrange((value) => !value);
              }}
              onSelect={selectNode}
              onToggleDetail={(key) => setOpenFamilyDetails((previous) => {
                const next = new Set(previous);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })}
              onDescription={changeDescription}
              onImage={changeImage}
              onMove={moveFamily}
              onAdd={() => {
                setAdding({ kind: "family", parentId: selected.id });
                setNewName("");
                setCreateError(null);
              }}
            />
          )}
        </main>
      </div>

      {dirtyCount > 0 && (
        <div className="taxonomy-save-bar">
          <strong>
            {dirtyCount === 1
              ? t.taxonomyPendingOne
              : t.taxonomyPendingMany.replace("{n}", formatInt(dirtyCount, locale))}
          </strong>
          <button
            type="button"
            className="taxonomy-ghost-button"
            disabled={saving}
            onClick={discardAll}
          >{t.orderDiscard}</button>
          <button
            type="button"
            className="taxonomy-primary-button"
            disabled={demo || saving}
            onClick={saveAll}
          >{t.taxonomySaveAll}</button>
        </div>
      )}
    </div>
  );
}

function reconcileOrderMap(local: OrderMap, server: OrderMap): OrderMap {
  let changed = false;
  const next: OrderMap = {};
  for (const [scope, localOrder] of Object.entries(local)) {
    const serverOrder = server[scope];
    if (!serverOrder) {
      changed = true;
      continue;
    }
    const reconciled = reconcileSiblingOrder(localOrder, serverOrder);
    if (sameOrder(reconciled, serverOrder)) {
      changed = true;
      continue;
    }
    next[scope] = reconciled;
    if (!sameOrder(reconciled, localOrder)) changed = true;
  }
  return changed ? next : local;
}

function CreateForm({
  label,
  hint,
  value,
  pending,
  locale,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  hint: string;
  value: string;
  pending: boolean;
  locale: Locale;
  error?: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = getDict(locale);
  return (
    <form
      className="taxonomy-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <strong>{label}</strong>
      <input
        type="text"
        className="admin-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t.taxonomyName}
        autoFocus
        maxLength={160}
      />
      <button type="submit" className="taxonomy-primary-button" disabled={pending || !value.trim()}>
        {t.taxonomyCreate}
      </button>
      <button type="button" className="taxonomy-ghost-button" disabled={pending} onClick={onCancel}>
        {t.fxCancel}
      </button>
      <span>{hint}</span>
      {error && <p className="taxonomy-form-error">{error}</p>}
    </form>
  );
}

function MediaStrip({
  node,
  locale,
  description,
  file,
  demo,
  pendingChanges,
  onEdit,
}: {
  node: AdminTaxonomyNode;
  locale: Locale;
  description: string;
  file?: File;
  demo: boolean;
  pendingChanges: boolean;
  onEdit: () => void;
}) {
  const t = getDict(locale);
  const settingsHref = node.kind === "category"
    ? `/${locale}/admin/products/categories/${node.id}`
    : `/${locale}/admin/products/categories/${node.parentId}#family-${node.id}`;
  return (
    <div className="taxonomy-media-strip">
      <NodeImage node={node} className="taxonomy-image-64" />
      <div className="taxonomy-media-copy">
        <span className="taxonomy-image-caption tech">
          {node.kind === "family" ? t.taxonomyFamilyImage : t.taxonomyCategoryImage}
        </span>
        <strong>{t.taxonomyDescription}</strong>
        <p>{description || t.taxonomyDescriptionEmpty}</p>
        {file && <span className="taxonomy-file-note tech">{file.name}</span>}
      </div>
      <div className="taxonomy-media-actions">
        <button type="button" disabled={demo} onClick={onEdit}>
          {t.taxonomyEditImageText}
        </button>
        <Link href={settingsHref}>{t.taxonomyFullSettings}</Link>
        {!pendingChanges && (
          <DeleteControl
            what={node.kind}
            id={node.id}
            name={nodeName(node, locale)}
            products={node.productCount}
            families={node.kind === "category" ? node.familyCount : undefined}
            ordered={node.orderedProducts}
            locale={locale}
            demo={demo}
          />
        )}
      </div>
    </div>
  );
}

function MediaEditorPanel({
  node,
  locale,
  value,
  file,
  pending,
  onChange,
  onFile,
  onSave,
  onCancel,
}: {
  node: AdminTaxonomyNode;
  locale: Locale;
  value: string;
  file?: File;
  pending: boolean;
  onChange: (value: string) => void;
  onFile: (file: File | undefined) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = getDict(locale);
  return (
    <div className="taxonomy-media-editor">
      <label className="taxonomy-image-drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <span>{t.taxonomyDropImage}</span>
        <u>{t.taxonomyBrowse}</u>
        <small>{file?.name ?? t.taxonomyImageRequirements}</small>
      </label>
      <div className="taxonomy-media-editor-fields">
        <label>
          <strong>
            {node.kind === "family" ? t.taxonomyFamilyDescription : t.taxonomyCategoryDescription}
          </strong>
          <textarea
            rows={4}
            maxLength={2000}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <div>
          <button type="button" className="taxonomy-primary-button" disabled={pending} onClick={onSave}>
            {t.taxonomySaveImageText}
          </button>
          <button type="button" className="taxonomy-ghost-button" disabled={pending} onClick={onCancel}>
            {t.fxCancel}
          </button>
          <span>{t.taxonomyAppliesOnly.replace("{name}", nodeName(node, locale))}</span>
        </div>
      </div>
    </div>
  );
}

function NodeImage({ node, className }: { node: AdminTaxonomyNode; className: string }) {
  if (!node.imageUrl) return <span className={`${className} taxonomy-image-placeholder`} />;
  return (
    <span className={className}>
      <Image src={node.imageUrl} alt="" width={96} height={96} unoptimized />
    </span>
  );
}

function FamiliesPane({
  category,
  families,
  locale,
  demo,
  arrange,
  openDetails,
  effectiveContent,
  onArrange,
  onSelect,
  onToggleDetail,
  onDescription,
  onImage,
  onMove,
  onAdd,
}: {
  category: AdminTaxonomyNode;
  families: AdminTaxonomyNode[];
  locale: Locale;
  demo: boolean;
  arrange: boolean;
  openDetails: Set<TaxonomyNodeKey>;
  effectiveContent: (node: AdminTaxonomyNode) => ContentEdit;
  onArrange: () => void;
  onSelect: (key: TaxonomyNodeKey) => void;
  onToggleDetail: (key: TaxonomyNodeKey) => void;
  onDescription: (node: AdminTaxonomyNode, value: string) => void;
  onImage: (node: AdminTaxonomyNode, file: File | undefined) => void;
  onMove: (node: AdminTaxonomyNode, by: -1 | 1) => void;
  onAdd: () => void;
}) {
  const t = getDict(locale);
  return (
    <section className="taxonomy-section">
      <div className="taxonomy-section-heading">
        <h2>{t.taxonomyProductFamilies}</h2>
        <span className="tech">{t.taxonomyFamilyOrderHint}</span>
        <button type="button" className="taxonomy-arrange-families" disabled={demo} onClick={onArrange}>
          {arrange ? t.taxonomyDoneArranging : t.taxonomyArrangeFamilies}
        </button>
      </div>

      {families.length === 0 ? (
        <div className="taxonomy-family-empty">
          <strong>{t.taxonomyNoFamiliesYet}</strong>
          <button type="button" className="taxonomy-add-root" disabled={demo} onClick={onAdd}>
            + {t.taxonomyProductFamily}
          </button>
          <span className="tech">
            {category.depth === 0
              ? t.taxonomyEmptyTopHint.replace("{name}", nodeName(category, locale))
              : t.taxonomyEmptyDepthHint
                  .replace("{depth}", formatInt(category.depth + 1, locale))
                  .replace("{name}", nodeName(category, locale))}
          </span>
        </div>
      ) : (
        families.map((family, index) => {
          const detailOpen = openDetails.has(family.key);
          const edit = effectiveContent(family);
          const description = locale === "fa" ? edit.aboutFa : edit.aboutEn;
          return (
            <div key={family.key} className="taxonomy-family-row-wrap">
              <div className="taxonomy-family-row">
                <button type="button" className="taxonomy-family-name" onClick={() => onSelect(family.key)}>
                  {nodeName(family, locale)}
                </button>
                <span className="tech taxonomy-family-meta">
                  {formatInt(family.productCount, locale)} {t.productsLower}
                </span>
                <span className="taxonomy-family-stock">
                  {t.stockAvailable}: <strong className="tech">{formatInt(family.inventoryAvailable, locale)}</strong>
                </span>
                <span className="tech taxonomy-imported">
                  {family.productCount > 0 ? t.taxonomyImportUnknown : t.taxonomyNeverImported}
                </span>
                {!family.isVisible && <span className="pill pill-muted">{t.catalogHidden}</span>}
                <button type="button" className="taxonomy-text-link" onClick={() => onToggleDetail(family.key)}>
                  {detailOpen ? t.taxonomyCloseImageText : t.taxonomyImageText}
                </button>
                <a href={`/api/admin/family/${family.id}/template`} download>{t.downloadTemplate}</a>
                <a href={`/api/admin/family/${family.id}/export`} download>{t.exportProducts}</a>
                <Link href={`/${locale}/admin/products/${family.id}/columns`}>{t.editColumns}</Link>
                <span className="taxonomy-row-end">
                  {arrange ? (
                    <MoveButtons
                      index={index}
                      length={families.length}
                      locale={locale}
                      disabled={demo}
                      onMove={(by) => onMove(family, by)}
                    />
                  ) : (
                    <FamilyImportControl familyId={family.id} locale={locale} demo={demo} />
                  )}
                </span>
              </div>
              {detailOpen && (
                <div className="taxonomy-family-detail">
                  <label className="taxonomy-family-image-drop">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      disabled={demo}
                      onChange={(event) => onImage(family, event.target.files?.[0])}
                    />
                    <span>{edit.file?.name ?? t.taxonomyFamilyImage}</span>
                  </label>
                  <label>
                    <strong>{t.taxonomyFamilyDescription}</strong>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      disabled={demo}
                      value={description}
                      onChange={(event) => onDescription(family, event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

function SelectedFamilyPane({
  node,
  ancestors,
  locale,
  demo,
}: {
  node: AdminTaxonomyNode;
  ancestors: AdminTaxonomyNode[];
  locale: Locale;
  demo: boolean;
}) {
  const t = getDict(locale);
  return (
    <section className="taxonomy-section">
      <div className="taxonomy-section-heading">
        <h2>{t.taxonomyCatalogImport}</h2>
        <span className="tech">
          {t.taxonomyUnderBreadcrumb.replace(
            "{path}",
            ancestors.map((ancestor) => nodeName(ancestor, locale)).join(" / "),
          )}
        </span>
      </div>
      <div className="taxonomy-selected-import">
        <FamilyImportControl familyId={node.id} locale={locale} demo={demo} prominent />
        <a href={`/api/admin/family/${node.id}/template`} download>{t.downloadTemplate}</a>
        <a href={`/api/admin/family/${node.id}/export`} download>{t.exportProducts}</a>
        <Link href={`/${locale}/admin/products/${node.id}/columns`}>{t.editColumns}</Link>
        <span className="tech taxonomy-selected-import-note">
          {node.productCount > 0 ? t.taxonomyImportUnknown : t.taxonomyNoRowsImported}
        </span>
      </div>
    </section>
  );
}

function MoveButtons({
  index,
  length,
  locale,
  disabled,
  onMove,
}: {
  index: number;
  length: number;
  locale: Locale;
  disabled: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  const t = getDict(locale);
  return (
    <span className="taxonomy-move-buttons">
      <button type="button" disabled={disabled || index === 0} aria-label={t.columnsMoveUp} onClick={() => onMove(-1)}>↑</button>
      <button type="button" disabled={disabled || index === length - 1} aria-label={t.columnsMoveDown} onClick={() => onMove(1)}>↓</button>
    </span>
  );
}

function VisibilityButton({
  visible,
  name,
  locale,
  disabled,
  onToggle,
}: {
  visible: boolean;
  name: string;
  locale: Locale;
  disabled: boolean;
  onToggle: () => void;
}) {
  const t = getDict(locale);
  const label = (visible ? t.taxonomyHideFromCatalog : t.taxonomyShowInCatalog)
    .replace("{name}", name);
  return (
    <button
      type="button"
      className={`taxonomy-visibility-button ${visible ? "" : "is-hidden"}`}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" aria-hidden="true">
        <path
          d="M1.7 10S4.7 5 10 5s8.3 5 8.3 5-3 5-8.3 5-8.3-5-8.3-5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        {!visible && (
          <path
            d="m3 3 14 14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}

function createErrorText(
  message: Extract<TaxonomyCreateResult, { kind: "error" }>["message"],
  t: ReturnType<typeof getDict>,
): string {
  return message === "no-name"
    ? t.taxonomyCreateNoName
    : message === "has-families"
      ? t.taxonomyCreateHasFamilies
      : message === "has-subcategories"
        ? t.taxonomyCreateHasSubcategories
        : message === "duplicate-name"
          ? t.taxonomyCreateDuplicate
          : t.taxonomyCreateParentGone;
}

function saveErrorText(result: Exclude<TaxonomySaveResult, "saved">, t: ReturnType<typeof getDict>): string {
  return result === "bad-file-type"
    ? t.catalogEditBadFileType
    : result === "too-large"
      ? t.catalogEditTooLarge
      : result === "storage-missing"
        ? t.catalogEditStorageMissing
        : result === "upload-failed"
          ? t.catalogEditUploadFailed
          : result === "bad-data"
            ? t.taxonomySaveBadData
            : t.taxonomySaveStale;
}
