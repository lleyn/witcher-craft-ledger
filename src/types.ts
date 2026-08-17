export type Ingredient = { name: string; quantity: number; type: "material" | "substance" };

export type Material = {
  name: string;
  category: string;
  rarity?: string;
  substance?: string;
  location?: string;
  forage?: string;
  forageDc?: number | string | null;
  weight?: number | null;
  cost: number;
  potency?: number;
  estimated?: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  kind: "craft" | "alchemy";
  category: string;
  level: string;
  dc: number;
  time: string;
  ingredients: Ingredient[];
  batch: number;
  investment?: number;
  repairCost?: number;
  marketCost?: number;
  formulaCost?: number | string;
};

export type Catalog = {
  meta: { recipeCount: number; materialCount: number; sourceUrl: string; sourceName: string };
  materials: Material[];
  recipes: Recipe[];
};

export type Plan = {
  batches: number;
  output: number;
  total: number;
  purchases: Array<{ name: string; quantity: number; cost: number; estimated: boolean }>;
  steps: Array<{ recipe: Recipe; batches: number; depth: number }>;
  warnings: string[];
};
