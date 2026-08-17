import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NAME_RU, SUBSTANCE_RU, durationRu, formulaCostRu, nameRu, timeRu } from "../src/data/ru.ts";
import { calculatePlan, calculatePlanDuration, collectCraftableIngredients, combinePlans, createIndexes, normalizeKey, parseRecipeTime } from "../src/lib/planner.js";

const catalog = JSON.parse(await readFile(new URL("../src/data/catalog.generated.json", import.meta.url), "utf8"));
const indexes = createIndexes(catalog);
const recipe = (name) => catalog.recipes.find((item) => item.name === name);

test("catalog contains the complete normalized dataset", () => {
  assert.equal(catalog.recipes.length, 276);
  assert.equal(catalog.materials.length, 208);
  assert.equal(catalog.recipes.filter((item) => item.kind === "alchemy").length, 74);
  assert.equal(catalog.recipes.filter((item) => item.kind === "craft").length, 202);
});

test("every recipe, material and alchemical substance has a Russian label", () => {
  const catalogNames = new Set([...catalog.recipes.map((item) => item.name), ...catalog.materials.map((item) => item.name)]);
  assert.equal(catalogNames.size, 468);
  assert.equal(Object.keys(NAME_RU).length, catalogNames.size);

  for (const name of catalogNames) {
    assert.ok(NAME_RU[name], `Нет русского перевода: ${name}`);
    assert.match(nameRu(name), /[А-Яа-яЁё]/, name);
  }

  const substances = new Set(
    catalog.recipes.flatMap((item) => item.ingredients.filter((ingredient) => ingredient.type === "substance").map((ingredient) => ingredient.name)),
  );
  assert.deepEqual(substances, new Set(Object.keys(SUBSTANCE_RU)));
  for (const substance of substances) assert.match(nameRu(substance), /[А-Яа-яЁё]/, substance);

  for (const time of new Set(catalog.recipes.map((item) => item.time))) {
    assert.doesNotMatch(timeRu(time), /Minutes?|Rounds?|Hours?|^g /, time);
  }
  assert.equal(formulaCostRu("N/A"), "Нет в продаже");
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

test("cart combines ingredients, cost and production time", () => {
  assert.deepEqual(parseRecipeTime("1/2 Hour"), { minutes: 30, rounds: 0 });
  assert.deepEqual(parseRecipeTime("5 Rounds"), { minutes: 0, rounds: 5 });
  assert.deepEqual(parseRecipeTime("g Hours"), { minutes: 540, rounds: 0 });

  const daggerPlan = calculatePlan(recipe("Dagger"), catalog, { indexes, batches: 2 });
  const swallowPlan = calculatePlan(recipe("Swallow"), catalog, { indexes, batches: 3 });
  assert.deepEqual(calculatePlanDuration(daggerPlan), { minutes: 240, rounds: 0 });
  assert.deepEqual(calculatePlanDuration(swallowPlan), { minutes: 90, rounds: 0 });

  const cart = combinePlans([daggerPlan, swallowPlan]);
  assert.equal(cart.total, daggerPlan.total + swallowPlan.total);
  assert.deepEqual(cart.duration, { minutes: 330, rounds: 0 });
  assert.equal(durationRu(cart.duration), "5 ч 30 мин");
  assert.ok(cart.purchases.some((item) => item.name === "Timber" && item.quantity === 2));
  assert.ok(cart.purchases.some((item) => item.name === "Iron" && item.quantity === 2));
});
