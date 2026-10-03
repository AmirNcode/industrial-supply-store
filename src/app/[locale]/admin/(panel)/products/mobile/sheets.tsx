"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminTaxonomyNode, TaxonomyNodeKey } from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import {
  createTaxonomyNodeAction,
  deleteCatalogAction,
  type TaxonomyCreateResult,
} from "../actions";
import { createErrorText, nodeName } from "../taxonomyText";
import { EyeSlash, KindChip, Magnifier, Sheet } from "./parts";

export type CreateTarget = { kind: "category" | "family"; parentId: number | null };

/** Jump lists at most this many; past it, the person types one more letter. */
const JUMP_LIMIT = 60;

/**
 * Jump to any node by name, at any depth.
 *
 * The same matcher as the desktop rail — English name, Persian name and path,
 * case-insensitive in the page's language — so a search finds the same nodes
 * on both. Only the matches are listed, not the ancestors the rail shows to
 * hold its tree together: each row carries its own path instead.
 */
export function JumpSheet({
  nodes,
  locale,
  recent,
  ancestorsFor,
  effectiveVisibility,
  onPick,
  onClose,
}: {
  nodes: AdminTaxonomyNode[];
  locale: Locale;
  recent: AdminTaxonomyNode[];
  ancestorsFor: (node: AdminTaxonomyNode) => AdminTaxonomyNode[];
  effectiveVisibility: (node: AdminTaxonomyNode) => boolean;
  onPick: (key: TaxonomyNodeKey) => void;
  onClose: () => void;
}) {
  const t = getDict(locale);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase(locale);

  const matches = useMemo(() => {
    if (!needle) return [];
    return nodes
      .filter((node) =>
        `${node.nameEn} ${node.nameFa} ${node.path}`.toLocaleLowerCase(locale).includes(needle),
      )
      .sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  }, [needle, nodes, locale]);

  return (
    <Sheet labelledBy="mtx-jump-title" onClose={onClose} full>
      <div className="mtx-jump-head">
        <h2 id="mtx-jump-title" className="mtx-sheet-title">{t.taxonomyFindCategory}</h2>
        <button type="button" className="mtx-text-button" onClick={onClose}>
          {t.fxCancel}
        </button>
      </div>
      <div className="mtx-jump-search">
        <Magnifier />
        <input
          type="search"
          value={query}
          autoFocus
          enterKeyHint="search"
          autoComplete="off"
          aria-label={t.taxonomyFindCategory}
          placeholder={t.taxonomyFindCategory}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="mtx-jump-clear"
            aria-label={t.mobileJumpClear}
            onClick={() => setQuery("")}
          >
            ×
          </button>
        )}
      </div>

      <div className="mtx-jump-results">
        {!needle ? (
          recent.length > 0 && (
            <div className="mtx-recent">
              <h3 className="mtx-section-heading">{t.mobileJumpRecent}</h3>
              <div className="mtx-chips">
                {recent.map((node) => (
                  <button key={node.key} type="button" className="mtx-chip" onClick={() => onPick(node.key)}>
                    {nodeName(node, locale)}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : matches.length === 0 ? (
          <p className="mtx-list-note">{t.taxonomyNoMatches}</p>
        ) : (
          <>
            <p className="mtx-jump-count">
              {t.mobileJumpMatches.replace("{n}", formatInt(matches.length, locale))}
            </p>
            <ul>
              {matches.slice(0, JUMP_LIMIT).map((node) => {
                const path = ancestorsFor(node).map((a) => nodeName(a, locale));
                return (
                  <li key={node.key}>
                    <button type="button" className="mtx-jump-row" onClick={() => onPick(node.key)}>
                      <span className="mtx-jump-main">
                        <span className="mtx-row-name">
                          <Highlighted text={nodeName(node, locale)} needle={needle} locale={locale} />
                          {!effectiveVisibility(node) && <EyeSlash label={t.catalogHidden} />}
                        </span>
                        <span className="mtx-jump-path">
                          {path.length > 0 ? `${path.join(" / ")} /` : t.taxonomyTopLevel}
                        </span>
                      </span>
                      <KindChip node={node} locale={locale} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Highlighted({ text, needle, locale }: { text: string; needle: string; locale: Locale }) {
  const at = text.toLocaleLowerCase(locale).indexOf(needle);
  // A match on the other language's name or on the path: nothing to mark here.
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </span>
  );
}

/**
 * A new category, subcategory or family: a name and nothing else.
 *
 * The node is written at once, as on desktop, and opened. Its other name,
 * image and description belong to the details page it opens on. The sheet
 * waits for the refreshed tree to contain the new node before moving, so the
 * next screen is never a node the page does not know about yet.
 */
export function CreateSheet({
  target,
  locale,
  byKey,
  onCreated,
  onClose,
}: {
  target: CreateTarget;
  locale: Locale;
  byKey: ReadonlyMap<TaxonomyNodeKey, AdminTaxonomyNode>;
  onCreated: (key: TaxonomyNodeKey) => void;
  onClose: () => void;
}) {
  const t = getDict(locale);
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<TaxonomyNodeKey | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (awaiting && byKey.has(awaiting)) onCreated(awaiting);
  }, [awaiting, byKey, onCreated]);

  const parentPath = (() => {
    if (target.parentId === null) return t.taxonomyTopLevel;
    const parent = [...byKey.values()].find(
      (node) => node.kind === "category" && node.id === target.parentId,
    );
    if (!parent) return "";
    const names: string[] = [];
    let current: AdminTaxonomyNode | undefined = parent;
    while (current) {
      names.unshift(nodeName(current, locale));
      const parentId: number | null = current.parentId;
      current = parentId === null
        ? undefined
        : [...byKey.values()].find((node) => node.kind === "category" && node.id === parentId);
    }
    return t.taxonomyUnder.replace("{parent}", names.join(" / "));
  })();

  const title =
    target.kind === "family"
      ? t.taxonomyNewFamily
      : target.parentId === null
        ? t.taxonomyNewCategory
        : t.taxonomyNewSubcategory;
  const busy = pending || awaiting !== null;

  function submit() {
    if (busy || !name.trim()) return;
    setError(null);
    startTransition(async () => {
      let result: TaxonomyCreateResult;
      try {
        result = await createTaxonomyNodeAction({ ...target, name, locale });
      } catch {
        result = { kind: "error", message: "no-parent" };
      }
      if (result.kind === "error") {
        setError(createErrorText(result.message, t));
        return;
      }
      // A family opens on its own page, not on the category that holds it.
      setAwaiting(result.createdKey);
      router.refresh();
    });
  }

  return (
    <Sheet labelledBy="mtx-create-title" onClose={() => !busy && onClose()}>
      <form
        className="mtx-sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div>
          <h2 id="mtx-create-title" className="mtx-sheet-title">{title}</h2>
          <p className="mtx-sheet-path">{parentPath}</p>
        </div>
        <label className="mtx-field">
          <span className="mtx-field-label">{t.taxonomyName}</span>
          <input
            type="text"
            className={`mtx-input ${error ? "is-invalid" : ""}`}
            value={name}
            maxLength={160}
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "mtx-create-error" : "mtx-create-hint"}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          {error && <span id="mtx-create-error" className="mtx-field-error">{error}</span>}
        </label>
        <p id="mtx-create-hint" className="mtx-hint">{t.mobileCreateHint}</p>
        <button type="submit" className="mtx-button mtx-primary" disabled={busy || !name.trim()}>
          {t.mobileCreateAndOpen}
        </button>
        <button type="button" className="mtx-button mtx-ghost" disabled={busy} onClick={onClose}>
          {t.fxCancel}
        </button>
      </form>
    </Sheet>
  );
}

/**
 * Delete a node, behind the typed word. The same action and the same fields
 * as the desktop's `DeleteControl`; the server checks the word again.
 */
export function DeleteSheet({
  node,
  locale,
  demo,
  onDeleted,
  onClose,
}: {
  node: AdminTaxonomyNode;
  locale: Locale;
  demo: boolean;
  onDeleted: (name: string) => void;
  onClose: () => void;
}) {
  const t = getDict(locale);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = nodeName(node, locale);
  const confirmed = typed.trim().toUpperCase() === "DELETE";

  function submit() {
    if (!confirmed || pending || demo) return;
    const form = new FormData();
    form.set("id", String(node.id));
    form.set("what", node.kind);
    form.set("name", name);
    form.set("products", String(node.productCount));
    form.set("confirm", typed);
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteCatalogAction(null, form);
        if (result.kind === "deleted") onDeleted(result.name);
        else setError(result.message === "not-found" ? t.importFamilyGone : t.deleteNotConfirmed);
      } catch {
        setError(t.importFamilyGone);
      }
    });
  }

  return (
    <Sheet labelledBy="mtx-delete-title" onClose={() => !pending && onClose()}>
      <form
        className="mtx-sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id="mtx-delete-title" className="mtx-sheet-title">
          {t.mobileDeleteTitle.replace("{name}", name)}
        </h2>
        <p className="mtx-sheet-body">
          {(node.kind === "category" ? t.deleteCategoryWarn : t.deleteFamilyWarn)
            .replace("{name}", name)
            .replace("{families}", formatInt(node.familyCount, locale))
            .replace("{products}", formatInt(node.productCount, locale))}
          {node.orderedProducts > 0 &&
            ` ${t.deleteOrdered.replace("{n}", formatInt(node.orderedProducts, locale))}`}
        </p>
        <label className="mtx-field">
          <span className="mtx-field-label">{t.deleteNotConfirmed}</span>
          <input
            type="text"
            className={`mtx-input mtx-delete-input ${error ? "is-invalid" : ""}`}
            value={typed}
            placeholder={t.deleteType}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            aria-describedby={error ? "mtx-delete-error" : undefined}
            onChange={(event) => setTyped(event.target.value)}
          />
          {error && <span id="mtx-delete-error" className="mtx-field-error">{error}</span>}
        </label>
        <button type="submit" className="mtx-button mtx-destructive" disabled={!confirmed || pending || demo}>
          {node.kind === "family" ? t.mobileDeleteFamily : t.mobileDeleteCategory}
        </button>
        <button type="button" className="mtx-button mtx-ghost" disabled={pending} onClick={onClose}>
          {t.fxCancel}
        </button>
      </form>
    </Sheet>
  );
}
