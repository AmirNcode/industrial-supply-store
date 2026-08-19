import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function expectNoAccessibilityViolations(
  page: Page,
  testInfo: TestInfo,
  include?: string,
) {
  let scan = new AxeBuilder({ page }).withTags(WCAG_AA_TAGS);
  if (include) scan = scan.include(include);
  const result = await scan.analyze();

  if (result.violations.length > 0) {
    await testInfo.attach("axe-violations", {
      body: JSON.stringify(result.violations, null, 2),
      contentType: "application/json",
    });
  }

  expect(
    result.violations,
    result.violations
      .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`)
      .join("\n"),
  ).toEqual([]);
}
