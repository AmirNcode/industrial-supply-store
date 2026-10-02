"use client";

import type { AdminTaxonomyNode } from "@/lib/adminTaxonomy";
import { getDict } from "@/lib/i18n";
import { nodeName } from "../taxonomyText";
import type { MobileShared } from "./MobileWorkbench";
import { TopBar } from "./parts";

/** A node's names, image, visibility, description and diagram. */
export function EditDetails(
  props: MobileShared & { node: AdminTaxonomyNode; onCancel: () => void },
) {
  const { node, locale } = props;
  const t = getDict(locale);
  return (
    <div className="mtx-screen is-form">
      <TopBar
        start={<button type="button" className="mtx-text-button" onClick={props.onCancel}>{t.fxCancel}</button>}
        title={t.mobileEditTitle.replace("{name}", nodeName(node, locale))}
      />
    </div>
  );
}
