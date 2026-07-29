/**
 * Demo mode.
 *
 * Off by default, so a self-hosted production deployment is unaffected by
 * anything in this file. Set `DEMO_MODE=1` on the hosted demo only.
 *
 * What it changes:
 *   - /admin becomes publicly viewable with no password, so the RFQ inbox can
 *     be shown without handing out a credential
 *   - a persistent banner marks the site as sample data
 *   - the quote form warns, before anything is typed, that submissions are
 *     publicly visible
 *
 * That last one is not decoration. A public admin page means every submitted
 * company name, contact name, email, phone and delivery address is readable by
 * anyone with the URL. The warning is what makes that an informed choice by the
 * person entering the data rather than something done to them.
 */
export const DEMO_MODE = process.env.DEMO_MODE === "1";
