"use client";

import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict, type Locale } from "@/lib/i18n";
import { formatInt } from "@/lib/money";
import { nodeName } from "../taxonomyText";
import { backTarget, type MobileShared } from "./MobileWorkbench";
import {
  ChevronBack,
  ChevronForward,
  EyeSlash,
  KindChip,
  Magnifier,
  MoreButton,
  SectionHeading,
} from "./parts";

/**
 * One level of the tree: the top-level list, or a category and its children.
 *
 * A category holds subcategories or product families, never both — the same
 * rule as the desktop pane and the server. The add button for the kind a
 * category cannot take stays on screen, disabled, with the reason under it:
 * a button that silently vanished would leave the person hunting for it.
 */
export function MobileBrowse(props: MobileShared & { node: AdminTaxonomyNode | null }) {
  const { node, locale, demo } = props;
  const t = getDict(locale);
  const back = backTarget(node, props.categoriesById);

  const subcategories = props.orderedCategories(node?.id ?? null);
  const families = node ? props.orderedFamilies(node.id) : [];
  const hasSubcategories = subcategories.length > 0;
  const hasFamilies = families.length > 0;
  const empty = !hasSubcategories && !hasFamilies;
  const name = node ? nodeName(node, locale) : "";

  const addCategory = () => props.openCreate({ kind: "category", parentId: node?.id ?? null });
  const addFamily = () => node && props.openCreate({ kind: "family", parentId: node.id });

  return (
    <div className="mtx-screen is-browse">
      <NavRow
        locale={locale}
        backLabel={back ? (back.parent ? nodeName(back.parent, locale) : t.taxonomyAllCategories) : null}
        onBack={back ? () => props.navigate(back.route) : undefined}
        onJump={props.openJump}
      />

      {node ? <NodeHeader {...props} node={node} /> : <h1 className="sr-only">{t.taxonomyAllCategories}</h1>}

      <div className="mtx-banners">{props.banners}</div>

      {empty ? (
        <section className="mtx-empty">
          {node ? (
            <>
              <h2>{t.mobileEmptyTitle.replace("{name}", name)}</h2>
              <p>{t.mobileEmptyBody}</p>
              <button type="button" className="mtx-button mtx-primary" disabled={demo} onClick={addFamily}>
                + {t.taxonomyProductFamily}
              </button>
              <button type="button" className="mtx-button mtx-ghost" disabled={demo} onClick={addCategory}>
                + {t.taxonomySubcategory}
              </button>
            </>
          ) : (
            <>
              <h2>{t.taxonomyNoCategories}</h2>
              <button type="button" className="mtx-button mtx-primary" disabled={demo} onClick={addCategory}>
                + {t.taxonomyCategory}
              </button>
            </>
          )}
        </section>
      ) : (
        <section className="mtx-list">
          <SectionHeading
            count={formatInt(hasFamilies ? families.length : subcategories.length, locale)}
          >
            {hasFamilies
              ? t.taxonomyProductFamilies
              : node
                ? t.taxonomySubcategories
                : t.taxonomyAllCategories}
          </SectionHeading>
          <ul>
            {(hasFamilies ? families : subcategories).map((child) => (
              <ChildRow
                key={child.key}
                node={child}
                locale={locale}
                visible={props.effectiveVisibility(child)}
                onOpen={() => props.navigate({ cat: child.key })}
              />
            ))}
          </ul>
        </section>
      )}

      {!empty && !props.hasPending && (
        <div className="mtx-bottom-bar">
          {node ? (
            <>
              <div className="mtx-bottom-actions">
                {hasFamilies ? (
                  <>
                    <button type="button" className="mtx-button mtx-primary" disabled={demo} onClick={addFamily}>
                      + {t.taxonomyProductFamily}
                    </button>
                    <button
                      type="button"
                      className="mtx-button mtx-blocked"
                      disabled
                      aria-describedby="mtx-rule-reason"
                    >
                      + {t.taxonomySubcategory}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="mtx-button mtx-primary" disabled={demo} onClick={addCategory}>
                      + {t.taxonomySubcategory}
                    </button>
                    <button
                      type="button"
                      className="mtx-button mtx-blocked"
                      disabled
                      aria-describedby="mtx-rule-reason"
                    >
                      + {t.taxonomyProductFamily}
                    </button>
                  </>
                )}
              </div>
              <p id="mtx-rule-reason" className="mtx-rule-reason">
                {(hasFamilies ? t.mobileSubcategoryBlocked : t.mobileFamilyBlocked).replace("{name}", name)}
              </p>
            </>
          ) : (
            <div className="mtx-bottom-actions">
              <button type="button" className="mtx-button mtx-primary" disabled={demo} onClick={addCategory}>
                + {t.taxonomyCategory}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** ‹ Parent on the left, the Jump pill filling the rest. */
export function NavRow({
  locale,
  backLabel,
  onBack,
  onJump,
}: {
  locale: Locale;
  backLabel: string | null;
  onBack?: () => void;
  onJump: () => void;
}) {
  const t = getDict(locale);
  return (
    <nav className="mtx-nav-row">
      {backLabel !== null && onBack && (
        <button type="button" className="mtx-back" onClick={onBack}>
          <ChevronBack />
          <span>{backLabel}</span>
        </button>
      )}
      <button type="button" className="mtx-jump-pill" aria-haspopup="dialog" onClick={onJump}>
        <Magnifier />
        <span>{t.taxonomyFindCategory}</span>
      </button>
    </nav>
  );
}

/** Name, kind, counts, and the node's two actions: edit and ···. */
export function NodeHeader(props: MobileShared & { node: AdminTaxonomyNode }) {
  const { node, locale, demo } = props;
  const t = getDict(locale);
  const editLabel =
    node.kind === "family"
      ? t.mobileEditDetails
      : node.depth === 0
        ? t.mobileEditCategory
        : t.mobileEditSubcategory;
  const meta =
    node.kind === "family"
      ? t.mobileFamilyMeta
          .replace("{products}", formatInt(node.productCount, locale))
          .replace("{stock}", formatInt(node.inventoryAvailable, locale))
      : t.taxonomyCategoryMeta
          .replace("{families}", formatInt(node.familyCount, locale))
          .replace("{products}", formatInt(node.productCount, locale));
  return (
    <section className={`mtx-node-header ${node.kind === "family" ? "is-family" : ""}`}>
      <div className="mtx-node-title">
        <h1>{nodeName(node, locale)}</h1>
        <KindChip node={node} locale={locale} />
      </div>
      <p className="mtx-node-meta">{meta}</p>
      <div className="mtx-node-actions">
        <button
          type="button"
          className="mtx-button mtx-ghost mtx-secondary"
          disabled={demo}
          onClick={() => props.navigate({ cat: node.key, edit: true }, { returnable: true })}
        >
          {editLabel}
        </button>
        {/* Hidden, not disabled, while anything is unsaved: a delete would
            refresh the tree under the drafts. Same rule as the desktop. */}
        {!props.hasPending && (
          <MoreButton
            label={t.mobileMore}
            className="mtx-secondary"
            disabled={demo}
            onClick={() => props.openDelete(node)}
          />
        )}
      </div>
    </section>
  );
}

function ChildRow({
  node,
  locale,
  visible,
  onOpen,
}: {
  node: AdminTaxonomyNode;
  locale: Locale;
  visible: boolean;
  onOpen: () => void;
}) {
  const t = getDict(locale);
  const parts =
    node.kind === "family"
      ? [
          t.mobileFamilyMeta
            .replace("{products}", formatInt(node.productCount, locale))
            .replace("{stock}", formatInt(node.inventoryAvailable, locale)),
        ]
      : [
          t.taxonomyCategoryMeta
            .replace("{families}", formatInt(node.familyCount, locale))
            .replace("{products}", formatInt(node.productCount, locale)),
          ...(node.familyCount === 0 ? [t.taxonomyNoFamiliesNote] : []),
        ];
  if (!visible) parts.push(t.mobileHiddenNote);
  return (
    <li>
      <button type="button" className="mtx-row" onClick={onOpen}>
        <span className="mtx-row-main">
          <span className="mtx-row-name">
            <span>{nodeName(node, locale)}</span>
            {!visible && <EyeSlash label={t.catalogHidden} />}
          </span>
          <span className="mtx-row-meta">{parts.join(" · ")}</span>
        </span>
        <ChevronForward />
      </button>
    </li>
  );
}
