import { expect, it } from "vitest";

import { isProductHost, productClientId } from "../src/session/rp";

// front-*.tachiiri.workers.dev（ワーカー既定ホスト）は入口として使わないので、ここでは規定しない。
it("プロダクトドメインは product host、auth origin は除外", () => {
  expect(isProductHost("graph.tachiiri.com")).toBe(true);
  expect(isProductHost("dev.admin.tachiiri.com")).toBe(true);
  expect(isProductHost("authn.tachiiri.com")).toBe(false);
  expect(isProductHost("dev.authn.tachiiri.com")).toBe(false);
  expect(isProductHost("localhost")).toBe(false);
});

it("client_id は tachiiri の直前のラベル", () => {
  expect(productClientId("graph.tachiiri.com")).toBe("graph");
  expect(productClientId("dev.graph.tachiiri.com")).toBe("graph");
});
