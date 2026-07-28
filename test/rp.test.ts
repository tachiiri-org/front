import { expect, it } from "vitest";

import { isProductHost, productClientId } from "../src/session/rp";

it("workers.dev のアプリホストは product host ではない（RP リダイレクトを掛けない）", () => {
  // アカウント名の "tachiiri" ラベルを product ラベルと誤認すると、存在しない
  // authn.tachiiri.workers.dev へ飛ばしてログイン不能になる。
  expect(isProductHost("front-dev.tachiiri.workers.dev")).toBe(false);
  expect(isProductHost("front-stage.tachiiri.workers.dev")).toBe(false);
  expect(isProductHost("front-production.tachiiri.workers.dev")).toBe(false);
});

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
