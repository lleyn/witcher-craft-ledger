import { useDeferredValue, useMemo, useState } from "react";
import catalogJson from "./data/catalog.generated.json";
import { formulaCostRu, nameRu, timeRu, warningRu } from "./data/ru";
import { calculatePlan, collectCraftableIngredients, createIndexes, normalizeKey } from "./lib/planner.js";
import type { Catalog, Material, Plan, Recipe } from "./types";

const catalog = catalogJson as Catalog;
const indexes = createIndexes(catalog);
const LEVEL_LABELS: Record<string, string> = {
  Novice: "Новичок",
  Journeyman: "Подмастерье",
  Master: "Мастер",
  "Grand Master": "Гранд-мастер",
  Witcher: "Ведьмачье",
  Experimental: "Экспериментальное",
};

const CATEGORY_LABELS: Record<string, string> = {
  Components: "Компоненты",
  Weapons: "Оружие",
  Armor: "Броня",
  "Crossbow Upgrades": "Улучшения арбалета",
  Elderfolk: "Старшие народы",
  Ammunition: "Боеприпасы",
  "Armor Enhancements": "Улучшения брони",
  "Mobility Aids": "Протезы и кресла",
  Bombs: "Бомбы",
  Traps: "Ловушки",
  "Alchemical Items": "Алхимические предметы",
  Elixirs: "Эликсиры",
  "Mundane Potions": "Обычные зелья",
  "Witcher Potions": "Ведьмачьи зелья",
  "Blade Oils": "Масла для клинков",
  "Witcher Decoctions": "Ведьмачьи отвары",
  "Starting Witcher Gear": "Стартовое снаряжение ведьмака",
  "Bear School Gear": "Школа Медведя",
  "Cat School Gear": "Школа Кота",
  "Griffin School Gear": "Школа Грифона",
  "Manticore School Gear": "Школа Мантикоры",
  "Viper School Gear": "Школа Змеи",
  "Wolf School Gear": "Школа Волка",
};

const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} кр.`;
const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;

function SubstanceChoice({
  name,
  quantity,
  value,
  onChange,
}: {
  name: string;
  quantity: number;
  value?: string;
  onChange: (value: string) => void;
}) {
  const options = (indexes.substances.get(name) ?? []) as Material[];
  const current = options.find((item) => item.name === value) ?? options[0];
  return (
    <label className="substance-choice">
      <span>
        <i className={`substance substance-${name.toLowerCase()}`} />
        <b>{nameRu(name)}</b> ×{quantity}
      </span>
      <select value={current?.name ?? ""} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => (
          <option key={item.name} value={item.name}>
            {nameRu(item.name)} · {money(item.cost)}{item.potency === 2 ? " · 2 ед." : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProductionTree({ plan }: { plan: Plan }) {
  return (
    <div className="production-tree">
      {plan.steps.map((step, index) => (
        <div className="tree-step" style={{ "--depth": step.depth } as React.CSSProperties} key={`${step.recipe.id}-${index}`}>
          <span className="tree-rune">{step.depth ? "↳" : "◆"}</span>
          <div>
            <b>{nameRu(step.recipe.name)}</b>
            <small>{step.batches} парт. · СЛ {step.recipe.dc} · {timeRu(step.recipe.time)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "craft" | "alchemy">("all");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(catalog.recipes[0]?.id ?? "");
  const [crafted, setCrafted] = useState<Set<string>>(new Set());
  const [substanceChoices, setSubstanceChoices] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState(1);
  const deferredQuery = useDeferredValue(query);

  const categories = useMemo(
    () => [...new Set(catalog.recipes.filter((item) => kind === "all" || item.kind === kind).map((item) => item.category))],
    [kind],
  );
  const filtered = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    return catalog.recipes.filter((recipe) => {
      if (kind !== "all" && recipe.kind !== kind) return false;
      if (category !== "all" && recipe.category !== category) return false;
      return !search || `${nameRu(recipe.name)} ${recipe.name} ${categoryLabel(recipe.category)} ${recipe.category}`.toLowerCase().includes(search);
    });
  }, [deferredQuery, kind, category]);

  const selected = (catalog.recipes.find((item) => item.id === selectedId) ?? filtered[0] ?? catalog.recipes[0]) as Recipe;
  const craftable = useMemo(() => collectCraftableIngredients(selected, indexes) as Recipe[], [selected]);
  const plan = useMemo(
    () => calculatePlan(selected, catalog, { indexes, crafted, substanceChoices, batches }) as Plan,
    [selected, crafted, substanceChoices, batches],
  );

  const selectRecipe = (recipe: Recipe) => {
    setSelectedId(recipe.id);
    setCrafted(new Set());
    setSubstanceChoices({});
    setBatches(1);
  };
  const updateKind = (next: "all" | "craft" | "alchemy") => {
    setKind(next);
    setCategory("all");
  };
  const toggleCrafted = (name: string) => {
    const itemKey = normalizeKey(name);
    setCrafted((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Craft Ledger, наверх">
          <span className="brand-mark"><i>CL</i></span>
          <span><b>Craft Ledger</b><small>THE WITCHER TRPG</small></span>
        </a>
        <div className="dataset-note">
          <span>{catalog.meta.recipeCount}</span> рецептов <i /> <span>{catalog.meta.materialCount}</span> компонентов
        </div>
        <a className="source-link" href={catalog.meta.sourceUrl} target="_blank" rel="noreferrer">Источник данных ↗</a>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">Мастерская Континента</p>
            <h1>От руды до реликвии.<br /><em>Без счёта на полях.</em></h1>
            <p className="hero-copy">Выберите чертёж или формулу, решите какие компоненты изготовить самостоятельно — и получите дерево работ с предварительной себестоимостью.</p>
          </div>
          <div className="hero-seal" aria-hidden="true"><span>{catalog.meta.recipeCount}</span><small>формул<br />и чертежей</small></div>
        </section>

        <section className="workbench">
          <aside className="catalog-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">I · Каталог</p><h2>Выберите рецепт</h2></div>
              <span>{filtered.length}</span>
            </div>
            <div className="kind-tabs" role="tablist" aria-label="Тип рецепта">
              {([['all', 'Все'], ['craft', 'Ремесло'], ['alchemy', 'Алхимия']] as const).map(([value, label]) => (
                <button className={kind === value ? "active" : ""} onClick={() => updateKind(value)} key={value}>{label}</button>
              ))}
            </div>
            <label className="search-field">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию…" aria-label="Поиск рецептов" />
            </label>
            <label className="category-field">
              <span>Раздел</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">Все разделы</option>
                {categories.map((item) => <option value={item} key={item}>{categoryLabel(item)}</option>)}
              </select>
            </label>
            <div className="recipe-list">
              {filtered.map((recipe) => (
                <button className={`recipe-row ${selected.id === recipe.id ? "selected" : ""}`} onClick={() => selectRecipe(recipe as Recipe)} key={recipe.id}>
                  <span className={`recipe-icon ${recipe.kind}`}>{recipe.kind === "alchemy" ? "◉" : "◇"}</span>
                  <span><b>{nameRu(recipe.name)}</b><small>{categoryLabel(recipe.category)} · СЛ {recipe.dc}</small></span>
                  <i>›</i>
                </button>
              ))}
              {!filtered.length && <p className="empty-state">Ничего не найдено. Попробуйте другой запрос или раздел.</p>}
            </div>
          </aside>

          <article className="recipe-panel">
            <header className="recipe-header">
              <div>
                <p className="eyebrow">II · Технологическая карта</p>
                <span className={`kind-badge ${selected.kind}`}>{selected.kind === "alchemy" ? "Алхимия" : "Ремесло"}</span>
                <h2>{nameRu(selected.name)}</h2>
                <p>{categoryLabel(selected.category)} · {LEVEL_LABELS[selected.level] ?? selected.level}</p>
              </div>
              <dl className="recipe-stats">
                <div><dt>Сложность</dt><dd>{selected.dc}</dd></div>
                <div><dt>Время</dt><dd>{timeRu(selected.time)}</dd></div>
                <div><dt>Выход</dt><dd>×{selected.batch}</dd></div>
              </dl>
            </header>

            <section className="planner-section">
              <div className="section-heading"><div><p className="eyebrow">III · Компоненты</p><h3>Что покупать, а что изготовить</h3></div>
                <label className="batch-field"><span>Партий</span><input type="number" min="1" max="99" value={batches} onChange={(event) => setBatches(Math.max(1, Number(event.target.value) || 1))} /></label>
              </div>

              {selected.kind === "alchemy" ? (
                <div className="substance-grid">
                  {selected.ingredients.map((ingredient) => (
                    <SubstanceChoice key={ingredient.name} name={ingredient.name} quantity={ingredient.quantity * batches} value={substanceChoices[ingredient.name]} onChange={(value) => setSubstanceChoices((current) => ({ ...current, [ingredient.name]: value }))} />
                  ))}
                </div>
              ) : (
                <div className="ingredient-list">
                  {selected.ingredients.map((ingredient) => {
                    const subrecipe = indexes.recipes.get(normalizeKey(ingredient.name)) as Recipe | undefined;
                    const isCrafted = crafted.has(normalizeKey(ingredient.name));
                    const material = indexes.materials.get(normalizeKey(ingredient.name)) as Material | undefined;
                    return (
                      <div className="ingredient-row" key={`${selected.id}-${ingredient.name}`}>
                        <span><b>{nameRu(ingredient.name)}</b><small>{material ? `${money(material.cost)} / ед.` : "Цена через вложенный рецепт"}</small></span>
                        <strong>×{ingredient.quantity * batches}</strong>
                        {subrecipe?.kind === "craft" ? (
                          <button className={isCrafted ? "make active" : "make"} onClick={() => toggleCrafted(ingredient.name)}>{isCrafted ? "Изготовить" : "Купить"}</button>
                        ) : <span className="raw-tag">сырьё</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {!!craftable.length && <div className="craftable-box">
                <div className="craftable-head">
                  <div><b>Доступно вложенное производство</b><small>{craftable.length} компонентов в этой цепочке</small></div>
                  <button onClick={() => setCrafted(crafted.size ? new Set() : new Set(craftable.map((item) => normalizeKey(item.name))))}>{crafted.size ? "Покупать всё" : "Изготовить всё"}</button>
                </div>
                <div className="craftable-options">
                  {craftable.map((item) => {
                    const active = crafted.has(normalizeKey(item.name));
                    return <button className={active ? "active" : ""} onClick={() => toggleCrafted(item.name)} key={item.id}><span>{active ? "◆" : "◇"}</span>{nameRu(item.name)}</button>;
                  })}
                </div>
              </div>}
            </section>

            <section className="result-section">
              <div className="section-heading"><div><p className="eyebrow">IV · Смета</p><h3>План производства</h3></div><span className="output-pill">На выходе: {plan.output}</span></div>
              <div className="result-grid">
                <div className="tree-card"><h4>Последовательность работ</h4><ProductionTree plan={plan} /></div>
                <div className="cost-card">
                  <p>Предварительная себестоимость</p>
                  <strong>{money(plan.total)}</strong>
                  <small>по ценам компонентов из каталога</small>
                  <div className="cost-comparison">
                    {selected.investment != null && <span><small>Инвестиции в источнике</small><b>{money(selected.investment * batches)}</b></span>}
                    {selected.marketCost != null && <span><small>Рыночная цена</small><b>{money(selected.marketCost * batches)}</b></span>}
                    {selected.formulaCost != null && <span><small>Цена формулы</small><b>{typeof selected.formulaCost === "number" ? money(selected.formulaCost) : formulaCostRu(selected.formulaCost)}</b></span>}
                  </div>
                </div>
              </div>

              <details className="purchase-list" open>
                <summary>Список закупки <span>{plan.purchases.length} позиций</span></summary>
                <div>
                  {plan.purchases.map((item) => <p key={item.name}><span>{nameRu(item.name)}{item.estimated ? " ≈" : ""}</span><b>×{item.quantity}</b><strong>{money(item.cost)}</strong></p>)}
                </div>
              </details>
              {!!plan.warnings.length && <div className="warning-box">{plan.warnings.map((warning) => <p key={warning}>{warningRu(warning)}</p>)}</div>}
            </section>
          </article>
        </section>
      </main>

      <footer>
        <p><b>Craft Ledger</b> — неофициальный бесплатный помощник и не замена книгам правил.</p>
        <p>Данные: <a href={catalog.meta.sourceUrl} target="_blank" rel="noreferrer">Complete Craftsman's Catalogue by SorrowChant</a>. The Witcher и связанные знаки принадлежат их правообладателям.</p>
      </footer>
    </div>
  );
}

export default App;
