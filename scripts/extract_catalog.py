"""Extract a compact Craft Ledger catalogue from the community XLSX compendium.

Usage:
    python scripts/extract_catalog.py path/to/witcher-crafts.xlsx src/data/catalog.generated.json
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl


SOURCE_URL = "https://docs.google.com/spreadsheets/d/1-kthEEQi65yscW7I8vHZbzvueOoPCV5neIW3TBZgv9o/edit?usp=sharing"
PURE_SUBSTANCES_URL = "https://rtalsoriangames.com/wp-content/uploads/2022/05/RTG-WI-DLC-AProfessionalsTools.pdf"

SUBSTANCE_HASHES = {
    "8cad5ee8d1": "Aether",
    "8bb7f9d558": "Caelum",
    "ecaf15d964": "Fulgur",
    "b098452c2e": "Hydragenum",
    "7e6923e1a4": "Quebrith",
    "c053309578": "Rebis",
    "1827e82c33": "Sol",
    "a4eb9cff9a": "Vermilion",
    "299e3ab4d5": "Vitriol",
}

ALIASES = {
    "tretegor steel": "Tretogor Steel",
    "tretogor steel": "Tretogor Steel",
    "hardened timber": "Hardened Timber",
    "sharpening grit": "Sharpening Grit",
    "etching acid": "Etching Acid",
    "ester grease": "Ester Grease",
    "river clay": "River Clay",
    "darkening oil": "Darkening Oil",
    "drake oil": "Drake Oil",
    "ogre wax": "Ogre Wax",
    "zerrikanian powder": "Zerrikanian Powder",
    "zerikanian powder": "Zerrikanian Powder",
    "sulphur": "Sulfur",
    "ginitia petals": "Ginatia Petals",
    "peasant s maul": "Peasant's Maul",
    "field doctor s syringe": "Field Doctor's Syringe",
    "horseman s hammer": "Horseman's Hammer",
    "huntsman s crossbow": "Huntsman's Crossbow",
    "investigator s helper": "Investigator's Helper",
    "rottfiend blood": "Rotfiend Blood",
    "arachas eye": "Arachas Eyes",
    "wyvern eye": "Wyvern Eyes",
    "hag ear": "Grave Hag Ear",
    "cortinarius": "Cortinarus",
    "optima matter": "Optima Mater",
}


def clean_text(value: object) -> str:
    text = str(value or "").replace("�", "'").replace("’", "'").strip()
    return re.sub(r"\s+", " ", text)


def key(value: object) -> str:
    text = clean_text(value).lower()
    text = unicodedata.normalize("NFKD", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return text


def canonical(value: object) -> str:
    text = clean_text(value)
    return ALIASES.get(key(text), text)


def slug(value: object) -> str:
    return key(value).replace(" ", "-")


def quantity(value: object) -> int:
    match = re.search(r"x\s*(\d+)", clean_text(value), re.I)
    return int(match.group(1)) if match else 1


def batch_from_name(name: str) -> int:
    match = re.search(r"\(x\s*(\d+)\)\s*$", name, re.I)
    return int(match.group(1)) if match else 1


def parse_component_text(text: object) -> list[dict]:
    source = clean_text(text).replace(",", " ")
    pattern = re.compile(r"(.+?)\s*\(x\s*(\d+)\)(?=\s+[^()]+?\s*\(x\s*\d+\)|$)", re.I)
    return [
        {"name": canonical(match.group(1)), "quantity": int(match.group(2)), "type": "material"}
        for match in pattern.finditer(source)
    ]


def parse_component_pairs(sheet, row: int, start_col: int, end_col: int) -> list[dict]:
    result = []
    for col in range(start_col, end_col + 1, 2):
        name = sheet.cell(row, col).value
        if not name:
            continue
        result.append(
            {
                "name": canonical(name),
                "quantity": quantity(sheet.cell(row, col + 1).value),
                "type": "material",
            }
        )
    return result


def image_ingredients(sheet) -> dict[int, list[dict]]:
    by_row: dict[int, Counter] = defaultdict(Counter)
    for image in sheet._images:
        anchor = image.anchor._from
        col = anchor.col + 1
        row = anchor.row + 1
        if not 5 <= col <= 14:
            continue
        digest = hashlib.sha1(image._data()).hexdigest()[:10]
        substance = SUBSTANCE_HASHES.get(digest)
        if substance:
            by_row[row][substance] += 1
    return {
        row: [
            {"name": name, "quantity": count, "type": "substance"}
            for name, count in sorted(counter.items())
        ]
        for row, counter in by_row.items()
    }


def add_recipe(recipes: list[dict], recipe: dict) -> None:
    recipe["name"] = canonical(recipe["name"])
    recipe["id"] = f"{recipe['kind']}-{slug(recipe['category'])}-{slug(recipe['name'])}"
    recipe["batch"] = batch_from_name(recipe["name"])
    recipe.setdefault("sourceUrl", SOURCE_URL)
    recipes.append(recipe)


def extract_materials(workbook) -> list[dict]:
    materials = []
    craft = workbook["Crafting Components"]
    category = "Crafting Materials"
    for row in range(3, craft.max_row + 1):
        name = craft.cell(row, 2).value
        cost = craft.cell(row, 8).value
        if name and not isinstance(cost, (int, float)):
            category = clean_text(name)
        if name and isinstance(cost, (int, float)):
            materials.append(
                {
                    "name": canonical(name),
                    "category": category,
                    "rarity": clean_text(craft.cell(row, 3).value),
                    "location": clean_text(craft.cell(row, 4).value),
                    "forage": clean_text(craft.cell(row, 5).value),
                    "forageDc": craft.cell(row, 6).value,
                    "weight": craft.cell(row, 7).value,
                    "cost": cost,
                    "sourceUrl": SOURCE_URL,
                }
            )

    alchemy = workbook["Alchemy Substances"]
    for row in range(3, alchemy.max_row + 1):
        name = alchemy.cell(row, 2).value
        substance = alchemy.cell(row, 4).value
        cost = alchemy.cell(row, 10).value
        if name and substance and isinstance(cost, (int, float)):
            materials.append(
                {
                    "name": canonical(name),
                    "category": "Alchemy Substances",
                    "rarity": clean_text(alchemy.cell(row, 3).value),
                    "substance": clean_text(substance),
                    "location": clean_text(alchemy.cell(row, 6).value),
                    "forage": clean_text(alchemy.cell(row, 7).value),
                    "forageDc": alchemy.cell(row, 8).value,
                    "weight": alchemy.cell(row, 9).value,
                    "cost": cost,
                    "potency": 2 if clean_text(name).startswith("Pure ") else 1,
                    "sourceUrl": SOURCE_URL,
                }
            )

    deduped = {}
    for item in materials:
        deduped.setdefault(key(item["name"]), item)
    # Two catalogue ingredients are absent from the price lists. Their unit prices
    # can be reconciled exactly from the published recipe investment totals.
    deduped.setdefault(
        key("Etching Oil"),
        {
            "name": "Etching Oil",
            "category": "Inferred catalogue prices",
            "rarity": "",
            "location": "",
            "forage": "",
            "forageDc": None,
            "weight": None,
            "cost": 2,
            "estimated": True,
            "sourceUrl": SOURCE_URL,
        },
    )
    deduped.setdefault(
        key("Ruby Dust"),
        {
            "name": "Ruby Dust",
            "category": "Inferred catalogue prices",
            "rarity": "",
            "location": "",
            "forage": "",
            "forageDc": None,
            "weight": None,
            "cost": 99,
            "estimated": True,
            "sourceUrl": SOURCE_URL,
        },
    )
    for substance, cost in {
        "Aether": 50,
        "Caelum": 50,
        "Fulgur": 100,
        "Hydragenum": 100,
        "Quebrith": 50,
        "Rebis": 100,
        "Sol": 100,
        "Vermilion": 100,
        "Vitriol": 50,
    }.items():
        name = f"Pure {substance}"
        deduped.setdefault(
            key(name),
            {
                "name": name,
                "category": "Pure Alchemical Substances",
                "rarity": "P" if cost == 50 else "R",
                "substance": substance,
                "location": "Crafted with a Distillation Chamber",
                "forage": "",
                "forageDc": None,
                "weight": 0.1,
                "cost": cost,
                "potency": 2,
                "distilled": True,
                "sourceUrl": PURE_SUBSTANCES_URL,
            },
        )
    deduped.setdefault(
        key("Sweet Flag"),
        {
            "name": "Sweet Flag",
            "category": "Alchemy Substances",
            "rarity": "C",
            "substance": "Aether",
            "location": "Fields & Swamps",
            "forage": "1d10",
            "forageDc": 12,
            "weight": 0.1,
            "cost": 18,
            "sourceUrl": "https://rtalsoriangames.com/wp-content/uploads/2022/07/RTG-WI-DLC-ProsthesesandWheelchairs.pdf",
        },
    )
    return sorted(deduped.values(), key=lambda item: item["name"].lower())


def extract_component_recipes(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Component Diagrams"]
    level = "Novice"
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            heading = clean_text(name)
            if "Journeyman" in heading:
                level = "Journeyman"
            elif "Master" in heading:
                level = "Master"
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "craft",
                    "category": "Components",
                    "level": level,
                    "dc": dc,
                    "time": clean_text(sheet.cell(row, 4).value),
                    "ingredients": parse_component_text(sheet.cell(row, 5).value),
                    "investment": sheet.cell(row, 6).value,
                    "marketCost": sheet.cell(row, 7).value,
                },
            )


def extract_crafting_recipes(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Crafting Diagrams"]
    category = "Weapons"
    level = "Novice"
    category_headings = {
        "Weapons Diagrams": "Weapons",
        "Armor Diagrams": "Armor",
        "Crossbow Upgrades Diagrams": "Crossbow Upgrades",
        "Elderfolk Crafting Diagrams": "Elderfolk",
        "Ammunition Diagrams": "Ammunition",
        "Armor Enhancement Diagrams": "Armor Enhancements",
    }
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            heading = clean_text(name)
            category = category_headings.get(heading, category)
            if "Grand Master" in heading:
                level = "Grand Master"
            elif "Journeyman" in heading:
                level = "Journeyman"
            elif "Master" in heading:
                level = "Master"
            elif "Novice" in heading:
                level = "Novice"
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "craft",
                    "category": category,
                    "level": level,
                    "dc": dc,
                    "time": f"{sheet.cell(row, 4).value:g} Hours",
                    "ingredients": parse_component_pairs(sheet, row, 5, 26),
                    "investment": sheet.cell(row, 27).value,
                    "repairCost": sheet.cell(row, 28).value,
                    "marketCost": sheet.cell(row, 29).value,
                },
            )


def extract_witcher_gear(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Witcher Gear Diagrams"]
    category = "Witcher Gear"
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            category = clean_text(name).replace("  ", " ")
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "craft",
                    "category": category,
                    "level": "Witcher",
                    "dc": dc,
                    "time": f"{sheet.cell(row, 4).value:g} Hours",
                    "ingredients": parse_component_pairs(sheet, row, 5, 34),
                    "investment": sheet.cell(row, 35).value,
                    "repairCost": sheet.cell(row, 36).value,
                },
            )


def extract_experimental(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Experimental Items Diagrams"]
    category = "Bombs"
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            category = clean_text(name)
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "craft",
                    "category": category,
                    "level": "Experimental",
                    "dc": dc,
                    "time": clean_text(sheet.cell(row, 4).value),
                    "ingredients": parse_component_text(sheet.cell(row, 5).value),
                    "investment": sheet.cell(row, 6).value,
                },
            )


def extract_alchemy(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Alchemy Formulae"]
    icons = image_ingredients(sheet)
    category = "Alchemical Items"
    level = "Novice"
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            heading = clean_text(name)
            if heading in {"Alchemical Items", "Elixirs", "Mundane Potions"}:
                category = heading
            if "Journeyman" in heading:
                level = "Journeyman"
            elif "Master" in heading:
                level = "Master"
            elif "Novice" in heading:
                level = "Novice"
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "alchemy",
                    "category": category,
                    "level": level,
                    "dc": dc,
                    "time": clean_text(sheet.cell(row, 4).value),
                    "ingredients": icons.get(row, []),
                    "formulaCost": sheet.cell(row, 15).value,
                },
            )


def extract_witcher_consumables(workbook, recipes: list[dict]) -> None:
    sheet = workbook["Witcher Consumables Formulae"]
    icons = image_ingredients(sheet)
    category = "Witcher Potions"
    for row in range(3, sheet.max_row + 1):
        name, dc = sheet.cell(row, 2).value, sheet.cell(row, 3).value
        if name and not isinstance(dc, (int, float)):
            category = clean_text(name)
        if name and isinstance(dc, (int, float)):
            add_recipe(
                recipes,
                {
                    "name": name,
                    "kind": "alchemy",
                    "category": category,
                    "level": "Witcher",
                    "dc": dc,
                    "time": clean_text(sheet.cell(row, 4).value),
                    "ingredients": icons.get(row, []),
                },
            )


def extract_mobility_aids(recipes: list[dict]) -> None:
    source_url = "https://rtalsoriangames.com/wp-content/uploads/2022/07/RTG-WI-DLC-ProsthesesandWheelchairs.pdf"
    entries = [
        ("Basic Wheelchair", "Novice", 13, "5 Hours", "Cotton (x5), Linen (x1), Timber (x8)", 38, 76),
        ("Quality Wheelchair", "Journeyman", 16, "8 Hours", "Cotton (x6), Ester Grease (x2), Steel (x1), Leather (x2), Timber (x8)", 150, 300),
        ("Basic Prosthesis", "Novice", 13, "5 Hours", "Cotton (x1), Timber (x3), Leather (x1)", 38, 76),
        ("Magical Prosthesis", "Master", 10, "8 Hours", "Cotton (x3), Double Woven Linen (x2), Ester Grease (x4), Etching Acid (x4), Fifth Essence (x2), Hardened Timber (x3), Leather (x1), Steel (x1)", 375, 750),
        ("Witcher Prosthesis", "Master", 22, "9 Hours", "Cotton (x2), Double Woven Linen (x2), Ester Grease (x2), Etching Acid (x6), Fifth Essence (x3), Hardened Timber (x2), Hardened Leather (x1), Sharpening Grit (x1), Silver (x1), Steel (x2)", 600, 1200),
        ("Conduit Prosthesis", "Master", 24, "10 Hours", "Cotton (x4), Double Woven Linen (x2), Ester Grease (x4), Etching Acid (x8), Fifth Essence (x4), Gemstone (x1), Hardened Timber (x3), Leather (x1), Optima Matter (x1), Steel (x1), Wax (x1)", 750, 1500),
    ]
    for name, level, dc, time, components, investment, market_cost in entries:
        add_recipe(
            recipes,
            {
                "name": name,
                "kind": "craft",
                "category": "Mobility Aids",
                "level": level,
                "dc": dc,
                "time": time,
                "ingredients": parse_component_text(components),
                "investment": investment,
                "marketCost": market_cost,
                "sourceUrl": source_url,
            },
        )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_catalog.py input.xlsx output.json")
    source, destination = Path(sys.argv[1]), Path(sys.argv[2])
    workbook = openpyxl.load_workbook(source, data_only=True)
    image_workbook = openpyxl.load_workbook(source, data_only=False)
    materials = extract_materials(workbook)
    recipes: list[dict] = []
    extract_component_recipes(workbook, recipes)
    extract_crafting_recipes(workbook, recipes)
    extract_witcher_gear(workbook, recipes)
    extract_experimental(workbook, recipes)
    extract_alchemy(image_workbook, recipes)
    extract_witcher_consumables(image_workbook, recipes)
    extract_mobility_aids(recipes)

    # Prefer catalogue spellings for names used as ingredients.
    material_names = {key(item["name"]): item["name"] for item in materials}
    recipe_names = {key(item["name"]): item["name"] for item in recipes}
    for recipe in recipes:
        for ingredient in recipe["ingredients"]:
            lookup = key(ingredient["name"])
            ingredient["name"] = material_names.get(lookup, recipe_names.get(lookup, ingredient["name"]))

    output = {
        "meta": {
            "title": "The Witcher TRPG Craft Ledger",
            "sourceUrl": SOURCE_URL,
            "sourceName": "The Witcher TRPG Complete Craftsman's Catalogue by SorrowChant",
            "recipeCount": len(recipes),
            "materialCount": len(materials),
        },
        "materials": materials,
        "recipes": sorted(recipes, key=lambda item: (item["kind"], item["category"], item["name"])),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(recipes)} recipes and {len(materials)} materials to {destination}")


if __name__ == "__main__":
    main()
