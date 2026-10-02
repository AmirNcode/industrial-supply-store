"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  categoryNodeKey,
  parseTaxonomyNodeKey,
  type AdminTaxonomyNode,
  type TaxonomyNodeKey,
} from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import type { TaxonomySaveResponse, TaxonomySaveResult } from "../actions";
import type { ProductTableHandle } from "../productDrafts";
import type { ContentEdit } from "../TaxonomyWorkbench";
import { saveErrorText } from "../taxonomyText";
import { UnsavedOrderGuard } from "../UnsavedOrderGuard";
import { Banner } from "./parts";
import { MobileBrowse } from "./MobileBrowse";
import { MobileFamily } from "./MobileFamily";
import { EditDetails } from "./EditDetails";
import { CreateSheet, DeleteSheet, JumpSheet, type CreateTarget } from "./sheets";

export type MobileWorkbenchProps = {
  nodes: AdminTaxonomyNode[];
  locale: Locale;
  demo: boolean;
  byKey: ReadonlyMap<TaxonomyNodeKey, AdminTaxonomyNode>;
  categoriesById: ReadonlyMap<number, AdminTaxonomyNode>;
  orderedCategories: (parentId: number | null) => AdminTaxonomyNode[];
  orderedFamilies: (categoryId: number) => AdminTaxonomyNode[];
  ancestorsFor: (node: AdminTaxonomyNode) => AdminTaxonomyNode[];
  effectiveContent: (node: AdminTaxonomyNode) => ContentEdit;
  setNodeContent: (node: AdminTaxonomyNode, next: ContentEdit) => void;
  effectiveVisibility: (node: AdminTaxonomyNode) => boolean;
  setNodeVisibility: (node: AdminTaxonomyNode, visible: boolean) => void;
  dirtyCount: number;
  saving: boolean;
  saveResult: TaxonomySaveResult | null;
  saveFailure: TaxonomySaveResponse["failure"] | null;
  onDismissSaved: () => void;
  saveAll: () => Promise<boolean>;
  discardAll: () => void;
  productPending: number;
  onProductPending: (changedProducts: number) => void;
  productTable: RefObject<ProductTableHandle | null>;
  guardRequest: RefObject<((go: () => void) => void) | null>;
};

/** Where a screen sits: a node (none is the top-level list) and what of it. */
export type MobileRoute = {
  cat: TaxonomyNodeKey | null;
  edit?: boolean;
  product?: string | null;
};

type SheetState =
  | { kind: "jump" }
  | { kind: "create"; target: CreateTarget }
  | { kind: "delete"; node: AdminTaxonomyNode };

const RECENT_KEY = "admin-products-recent";
const RECENT_MAX = 5;

/**
 * The products page on a phone: the same tree, drafts and Save all as the
 * desktop workbench, shown one level at a time.
 *
 * Every screen is an address. `?cat=` is the node, as on desktop;
 * `edit=details` is its details page and `product=` one of a family's
 * products, so reload and Back always land where the person was. Sheets —
 * Jump, Create, Delete — have no address of their own, but each pushes a
 * history entry while it is open, so the phone's Back gesture closes it
 * rather than leaving the screen underneath.
 *
 * All drafts belong to the workbench and survive any move inside the page,
 * with one exception: a family's product edits belong to that family, as the
 * desktop's do, so moving to another node goes through the Save / Discard /
 * Stay sheet first. Nothing else asks, because nothing else loses work — the
 * pending bar stays on screen wherever the person goes.
 */
export function MobileWorkbench(props: MobileWorkbenchProps) {
  const {
    nodes,
    locale,
    demo,
    byKey,
    dirtyCount,
    productPending,
    productTable,
    guardRequest,
  } = props;
  const t = getDict(locale);
  const router = useRouter();
  const searchParams = useSearchParams();

  const catKey = parseTaxonomyNodeKey(searchParams.get("cat"));
  const node = catKey ? byKey.get(catKey) ?? null : null;
  const editing = searchParams.get("edit") === "details";
  const productPart = searchParams.get("product");

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [recent, setRecent] = useState<TaxonomyNodeKey[]>([]);

  const familyKey = node?.kind === "family" ? node.key : null;
  const pending = dirtyCount + productPending;

  /** Whether showing `cat` would drop the current family's product edits. */
  const dropsWork = useCallback(
    (cat: TaxonomyNodeKey | null) => productPending > 0 && cat !== familyKey,
    [productPending, familyKey],
  );

  const shouldGuard = useCallback(
    (destination: URL) =>
      destination.pathname !== window.location.pathname ||
      dropsWork(parseTaxonomyNodeKey(destination.searchParams.get("cat"))),
    [dropsWork],
  );

  function urlFor(route: MobileRoute): string {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (route.cat) url.searchParams.set("cat", route.cat);
    if (route.edit) url.searchParams.set("edit", "details");
    if (route.product) url.searchParams.set("product", route.product);
    return url.pathname + url.search;
  }

  /**
   * Show another screen. A move made from inside a sheet replaces the sheet's
   * own history entry, so Back afterwards returns to where the sheet was
   * opened rather than to a sheet that is no longer there.
   */
  function navigate(route: MobileRoute, options: { returnable?: boolean } = {}) {
    const url = urlFor(route);
    const go = () => {
      setSheet(null);
      setFlash(null);
      const fromSheet = window.history.state?.mtxSheet === true;
      // `mtxReturn` marks a screen whose own back button can simply go Back.
      const state = options.returnable ? { mtxReturn: true } : null;
      if (fromSheet) window.history.replaceState(state, "", url);
      else window.history.pushState(state, "", url);
      window.scrollTo(0, 0);
    };
    if (dropsWork(route.cat) && guardRequest.current) {
      setSheet(null);
      guardRequest.current(go);
      return;
    }
    go();
  }

  /** Back to `route`: by history when this screen was opened from there. */
  function goBack(route: MobileRoute) {
    if (window.history.state?.mtxReturn === true && !dropsWork(route.cat)) {
      window.history.back();
      return;
    }
    navigate(route);
  }

  function openSheet(next: SheetState) {
    setSheet(next);
    window.history.pushState({ mtxSheet: true }, "", window.location.href);
  }

  const closeSheet = useCallback(() => {
    if (window.history.state?.mtxSheet === true) window.history.back();
    else setSheet(null);
  }, []);

  // Back closes an open sheet; the sheet's entry is what Back just left.
  useEffect(() => {
    const onPopState = () => {
      if (window.history.state?.mtxSheet !== true) setSheet(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // The last few nodes visited, for Jump's Recent chips. Per browser only:
  // a convenience, so a private window or blocked storage just shows none.
  useEffect(() => {
    let stored: TaxonomyNodeKey[] = [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(raw)) {
        stored = raw
          .map((value) => parseTaxonomyNodeKey(typeof value === "string" ? value : null))
          .filter((value): value is TaxonomyNodeKey => value !== null);
      }
    } catch {
      stored = [];
    }
    const next = node
      ? [node.key, ...stored.filter((key) => key !== node.key)].slice(0, RECENT_MAX)
      : stored;
    if (node) {
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Storage refused; the chips are only a convenience.
      }
    }
    // Reading browser storage is the external system this effect syncs with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(next);
  }, [node]);

  // A success banner goes on its own after a few seconds; an edit clears it
  // sooner, through the workbench's own setters.
  const { saveResult, onDismissSaved } = props;
  useEffect(() => {
    if (saveResult !== "saved") return;
    const timer = window.setTimeout(onDismissSaved, 4000);
    return () => window.clearTimeout(timer);
  }, [saveResult, onDismissSaved]);

  async function saveEverything(): Promise<boolean> {
    if (savingAll) return false;
    setSavingAll(true);
    try {
      // Taxonomy first, then the products: the order the desktop guard uses.
      if (!(await props.saveAll())) return false;
      return productTable.current ? await productTable.current.save() : true;
    } finally {
      setSavingAll(false);
    }
  }

  function discardEverything() {
    props.discardAll();
    productTable.current?.discard();
  }

  const saveMessage =
    saveResult && saveResult !== "saved" ? saveErrorText(saveResult, t) : null;
  const banners = (
    <>
      {flash && <Banner tone="ok">{flash}</Banner>}
      {saveMessage && <Banner tone="error">{saveMessage}</Banner>}
      {saveResult === "saved" && <Banner tone="ok">{t.taxonomySaved}</Banner>}
    </>
  );

  const parentRoute = (of: AdminTaxonomyNode): MobileRoute => ({
    cat: of.parentId === null ? null : categoryNodeKey(of.parentId),
  });

  const shared = {
    ...props,
    banners,
    hasPending: pending > 0 && !demo,
    navigate,
    goBack,
    openJump: () => openSheet({ kind: "jump" }),
    openCreate: (target: CreateTarget) => openSheet({ kind: "create", target }),
    openDelete: (of: AdminTaxonomyNode) => openSheet({ kind: "delete", node: of }),
  };

  let screen: React.ReactNode;
  if (node && editing) {
    screen = node.kind === "family" ? (
      <MobileFamily key={node.key} {...shared} node={node} view="details" productPart={null} />
    ) : (
      <EditDetails {...shared} node={node} onCancel={() => goBack({ cat: node.key })} />
    );
  } else if (node?.kind === "family") {
    screen = (
      <MobileFamily
        key={node.key}
        {...shared}
        node={node}
        view={productPart ? "product" : "page"}
        productPart={productPart}
      />
    );
  } else {
    screen = <MobileBrowse {...shared} node={node} />;
  }

  return (
    <div className={`mtx ${node?.kind === "family" || editing ? "is-deep" : ""}`}>
      <UnsavedOrderGuard
        dirtyCount={pending}
        locale={locale}
        requestRef={guardRequest}
        shouldGuard={shouldGuard}
        variant="sheet"
        onSave={saveEverything}
        onDiscard={discardEverything}
        copy={{
          title: productPending > 0 ? t.productsUnsavedTitle : t.taxonomyUnsavedTitle,
          body: t.taxonomyUnsavedBody,
          scope: pending === 1
            ? t.taxonomyPendingOne
            : t.taxonomyPendingMany.replace("{n}", formatInt(pending, locale)),
        }}
      />

      {screen}

      {pending > 0 && !demo && (
        <div className="mtx-pending-bar" role="region" aria-label={t.taxonomySaveAll}>
          <div className="mtx-pending-text">
            <strong>
              {pending === 1
                ? t.taxonomyPendingOne
                : t.taxonomyPendingMany.replace("{n}", formatInt(pending, locale))}
            </strong>
            <span>{t.mobileNotSavedYet}</span>
          </div>
          <button
            type="button"
            className="mtx-pending-discard"
            disabled={savingAll || props.saving}
            onClick={discardEverything}
          >
            {t.orderDiscard}
          </button>
          <button
            type="button"
            className="mtx-pending-save"
            disabled={savingAll || props.saving}
            onClick={saveEverything}
          >
            {savingAll || props.saving ? t.productsSaving : t.taxonomySaveAll}
          </button>
        </div>
      )}

      {sheet?.kind === "jump" && (
        <JumpSheet
          nodes={nodes}
          locale={locale}
          recent={recent.map((key) => byKey.get(key)).filter((n): n is AdminTaxonomyNode => !!n)}
          ancestorsFor={props.ancestorsFor}
          effectiveVisibility={props.effectiveVisibility}
          onPick={(key) => navigate({ cat: key })}
          onClose={closeSheet}
        />
      )}
      {sheet?.kind === "create" && (
        <CreateSheet
          target={sheet.target}
          locale={locale}
          byKey={byKey}
          onCreated={(key) => navigate({ cat: key })}
          onClose={closeSheet}
        />
      )}
      {sheet?.kind === "delete" && (
        <DeleteSheet
          node={sheet.node}
          locale={locale}
          demo={demo}
          onDeleted={(name) => {
            navigate(parentRoute(sheet.node));
            setFlash(t.deleteDone.replace("{name}", name));
            router.refresh();
          }}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

export type MobileShared = MobileWorkbenchProps & {
  banners: React.ReactNode;
  hasPending: boolean;
  navigate: (route: MobileRoute, options?: { returnable?: boolean }) => void;
  goBack: (route: MobileRoute) => void;
  openJump: () => void;
  openCreate: (target: CreateTarget) => void;
  openDelete: (node: AdminTaxonomyNode) => void;
};

/** Shared by every node screen: the parent to go back to, and its label. */
export function backTarget(
  node: AdminTaxonomyNode | null,
  categoriesById: ReadonlyMap<number, AdminTaxonomyNode>,
): { route: MobileRoute; parent: AdminTaxonomyNode | null } | null {
  if (!node) return null;
  const parent = node.parentId === null ? null : categoriesById.get(node.parentId) ?? null;
  return { route: { cat: parent ? parent.key : null }, parent };
}
