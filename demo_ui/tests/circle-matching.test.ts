import test from "node:test";
import assert from "node:assert/strict";
import { matchingCircleSources, type CirclePost, type CircleSource } from "../src/circle-types";

test("private source suggestions distinguish H20 and H200 and only show the opposite side", () => {
  const post = { kind: "求购", title: "采购 NVIDIA H200 整机" } as CirclePost;
  const base: CircleSource = { id: "gpu", kind: "供应", model: "H200", title: "H200", quantity: "2台", city: "上海", mode: "现货" };
  assert.deepEqual(matchingCircleSources(post, [base, { ...base, model: "H20" }, { ...base, kind: "求购" }]), [base]);
  const rental = { ...base, mode: "租赁" };
  assert.deepEqual(matchingCircleSources({ ...post, mode: "租赁" }, [base, rental]), [rental]);
  assert.deepEqual(matchingCircleSources({ ...post, mode: "期货" }, [base, rental]), [base]);
});
