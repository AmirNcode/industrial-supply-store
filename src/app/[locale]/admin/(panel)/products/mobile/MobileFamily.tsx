"use client";

import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict } from "@/lib/i18n";
import { nodeName } from "../taxonomyText";
import { NavRow, NodeHeader } from "./MobileBrowse";
import { backTarget, type MobileShared } from "./MobileWorkbench";

/** A family: its page, one of its products, or its details. */
export function MobileFamily(
  props: MobileShared & {
    node: AdminTaxonomyNode;
    view: "page" | "product" | "details";
    productPart: string | null;
  },
) {
  const { node, locale } = props;
  const t = getDict(locale);
  const back = backTarget(node, props.categoriesById);
  return (
    <div className="mtx-screen">
      <NavRow
        locale={locale}
        backLabel={back?.parent ? nodeName(back.parent, locale) : t.taxonomyAllCategories}
        onBack={() => back && props.navigate(back.route)}
        onJump={props.openJump}
      />
      <NodeHeader {...props} node={node} />
      <div className="mtx-banners">{props.banners}</div>
    </div>
  );
}
