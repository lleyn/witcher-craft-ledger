export const normalizeKey = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function createIndexes(catalog) {
  const materials = new Map(catalog.materials.map((item) => [normalizeKey(item.name), item]));
  const recipes = new Map(catalog.recipes.map((item) => [normalizeKey(item.name), item]));
  const substances = new Map();

  for (const material of catalog.materials) {
    if (!material.substance) continue;
    const list = substances.get(material.substance) ?? [];
    list.push(material);
    substances.set(material.substance, list);
  }
  for (const list of substances.values()) {
    list.sort((a, b) => a.cost / (a.potency ?? 1) - b.cost / (b.potency ?? 1));
  }
  return { materials, recipes, substances };
}

export function collectCraftableIngredients(recipe, indexes, seen = new Set()) {
  const result = new Map();
  for (const ingredient of recipe.ingredients) {
    if (ingredient.type !== "material") continue;
    const ingredientKey = normalizeKey(ingredient.name);
    if (seen.has(ingredientKey)) continue;
    const subrecipe = indexes.recipes.get(ingredientKey);
    if (!subrecipe || subrecipe.kind !== "craft") continue;
    result.set(ingredientKey, subrecipe);
    const nested = collectCraftableIngredients(subrecipe, indexes, new Set([...seen, ingredientKey]));
    for (const nestedRecipe of nested) result.set(normalizeKey(nestedRecipe.name), nestedRecipe);
  }
  return [...result.values()];
}

function addPurchase(purchases, material, quantity, note = "") {
  const key = normalizeKey(material?.name ?? note);
  const existing = purchases.get(key) ?? {
    name: material?.name ?? note,
    quantity: 0,
    cost: 0,
    estimated: Boolean(material?.estimated),
  };
  existing.quantity += quantity;
  existing.cost += quantity * (material?.cost ?? 0);
  purchases.set(key, existing);
}

export function calculatePlan(recipe, catalog, options = {}) {
  const indexes = options.indexes ?? createIndexes(catalog);
  const crafted = options.crafted ?? new Set();
  const substanceChoices = options.substanceChoices ?? {};
  const batches = Math.max(1, Number(options.batches) || 1);
  const purchases = new Map();
  const steps = [];
  const warnings = [];

  function expand(current, multiplier, depth, trail) {
    const currentKey = normalizeKey(current.name);
    if (trail.has(currentKey)) {
      warnings.push(`Циклическая зависимость: ${current.name}`);
      return;
    }
    const nextTrail = new Set([...trail, currentKey]);
    steps.push({ recipe: current, batches: multiplier, depth });

    for (const ingredient of current.ingredients) {
      const required = ingredient.quantity * multiplier;
      if (ingredient.type === "substance") {
        const candidates = indexes.substances.get(ingredient.name) ?? [];
        const selectedName = substanceChoices[ingredient.name];
        const selected = candidates.find((item) => item.name === selectedName) ?? candidates[0];
        if (!selected) {
          warnings.push(`Нет цены для субстанции ${ingredient.name}`);
          continue;
        }
        const units = Math.ceil(required / (selected.potency ?? 1));
        addPurchase(purchases, selected, units);
        continue;
      }

      const ingredientKey = normalizeKey(ingredient.name);
      const subrecipe = indexes.recipes.get(ingredientKey);
      if (crafted.has(ingredientKey) && subrecipe?.kind === "craft") {
        const subBatches = Math.ceil(required / (subrecipe.batch ?? 1));
        expand(subrecipe, subBatches, depth + 1, nextTrail);
      } else {
        const material = indexes.materials.get(ingredientKey);
        if (material) addPurchase(purchases, material, required);
        else {
          warnings.push(`Нет цены для компонента ${ingredient.name}`);
          addPurchase(purchases, undefined, required, ingredient.name);
        }
      }
    }
  }

  expand(recipe, batches, 0, new Set());
  const purchaseList = [...purchases.values()].sort((a, b) => b.cost - a.cost);
  return {
    batches,
    output: (recipe.batch ?? 1) * batches,
    purchases: purchaseList,
    steps,
    warnings: [...new Set(warnings)],
    total: purchaseList.reduce((sum, item) => sum + item.cost, 0),
  };
}

export function parseRecipeTime(value) {
  if (value === "g Hours") return { minutes: 9 * 60, rounds: 0 };
  if (value === "1/2 Hour") return { minutes: 30, rounds: 0 };
  const match = String(value ?? "").match(/^(\d+) (Minute|Minutes|Round|Rounds|Hour|Hours)$/);
  if (!match) return { minutes: 0, rounds: 0 };
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("Minute")) return { minutes: amount, rounds: 0 };
  if (unit.startsWith("Round")) return { minutes: 0, rounds: amount };
  return { minutes: amount * 60, rounds: 0 };
}

export function calculatePlanDuration(plan) {
  return plan.steps.reduce(
    (total, step) => {
      const duration = parseRecipeTime(step.recipe.time);
      total.minutes += duration.minutes * step.batches;
      total.rounds += duration.rounds * step.batches;
      return total;
    },
    { minutes: 0, rounds: 0 },
  );
}

export function combinePlans(plans) {
  const purchases = new Map();
  const duration = { minutes: 0, rounds: 0 };
  const warnings = [];
  let stepCount = 0;

  for (const plan of plans) {
    for (const item of plan.purchases) {
      const key = normalizeKey(item.name);
      const existing = purchases.get(key) ?? { name: item.name, quantity: 0, cost: 0, estimated: false };
      existing.quantity += item.quantity;
      existing.cost += item.cost;
      existing.estimated ||= item.estimated;
      purchases.set(key, existing);
    }
    const planDuration = calculatePlanDuration(plan);
    duration.minutes += planDuration.minutes;
    duration.rounds += planDuration.rounds;
    stepCount += plan.steps.length;
    warnings.push(...plan.warnings);
  }

  const purchaseList = [...purchases.values()].sort((a, b) => b.cost - a.cost);
  return {
    purchases: purchaseList,
    total: purchaseList.reduce((sum, item) => sum + item.cost, 0),
    duration,
    stepCount,
    warnings: [...new Set(warnings)],
  };
}
