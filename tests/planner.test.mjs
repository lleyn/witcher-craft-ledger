import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculatePlan, collectCraftableIngredients, createIndexes, normalizeKey } from "../src/lib/planner.js";

const catalog = JSON.parse(await readFile(new URL("../src/data/catalog.generated.json", import.meta.url), "utf8"));
const indexes = createIndexes(catalog);
const recipe = (name) => catalog.recipes.find((item) => item.name === name);

test("catalog contains the complete normalized dataset", () => {
  assert.equal(catalog.recipes.length, 276);
  assert.equal(catalog.materials.length, 208);
  assert.equal(catalog.recipes.filter((item) => item.kind === "alchemy").length, 74);
  assert.equal(catalog.recipes.filter((item) => item.kind === "craft").length, 202);
});

test("every recipe can be priced without missing-component warnings", () => {
  for (const item of catalog.recipes) {
    const plan = calculatePlan(item, catalog, { indexes });
    assert.deepEqual(plan.warnings, [], item.name);
    assert.ok(Number.isFinite(plan.total), item.name);
  }
});

test("crafting an intermediate component expands the production tree", () => {
  const armingSword = recipe("Arming Sword");
  const available = collectCraftableIngredients(armingSword, indexes);
  assert.ok(available.some((item) => item.name === "Hardened Leather"));
  assert.ok(available.some((item) => item.name === "Steel"));

  const crafted = new Set([normalizeKey("Hardened Leather"), normalizeKey("Steel")]);
  const plan = calculatePlan(armingSword, catalog, { indexes, crafted });
  assert.ok(plan.steps.some((item) => item.recipe.name === "Hardened Leather"));
  assert.ok(plan.steps.some((item) => item.recipe.name === "Steel"));
  assert.ok(!plan.purchases.some((item) => item.name === "Hardened Leather"));
  assert.ok(!plan.purchases.some((item) => item.name === "Steel"));
});

test("alchemy picks valid ingredients and respects explicit choices", () => {
  const swallow = recipe("Swallow");
  const defaultPlan = calculatePlan(swallow, catalog, { indexes });
  assert.ok(defaultPlan.total > 0);
  assert.equal(defaultPlan.purchases.reduce((sum, item) => sum + item.quantity, 0), 3);

  const purePlan = calculatePlan(swallow, catalog, {
    indexes,
    substanceChoices: { Aether: "Pure Aether", Caelum: "Pure Caelum", Vitriol: "Pure Vitriol" },
  });
  assert.ok(purePlan.purchases.every((item) => item.name.startsWith("Pure ")));
});

test("batch count scales craft output and raw purchases", () => {
  const dagger = recipe("Dagger");
  const one = calculatePlan(dagger, catalog, { indexes, batches: 1 });
  const three = calculatePlan(dagger, catalog, { indexes, batches: 3 });
  assert.equal(three.output, one.output * 3);
  assert.equal(three.total, one.total * 3);
});
