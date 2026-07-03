from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = Path(r"C:\Users\willi\Desktop\peptides")
OUT = ROOT / "src" / "data" / "realSeed.ts"


def ascii_clean(value):
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("\n", " ").replace("，", ",").replace("：", ":")
    text = re.sub(r"\s+", " ", text).strip()
    return text.encode("ascii", "ignore").decode("ascii").strip()


def slug(value):
    value = ascii_clean(value).lower()
    value = value.replace("+", " plus ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "item"


def parse_price(value):
    text = ascii_clean(value)
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else None


def compact(value):
    return re.sub(r"[^a-z0-9]+", "", ascii_clean(value).lower())


def valid_sku(value):
    text = ascii_clean(value).replace(" ", "")
    if not text or len(text) > 18:
        return ""
    if text.lower() in {"catno", "cat.no", "code", "no"}:
        return ""
    if not re.search(r"\d", text):
        return ""
    return text


def normalize_name(name, sku=""):
    name = ascii_clean(name)
    sku = valid_sku(sku)
    signature = compact(f"{sku} {name}")
    upper_sku = sku.upper()

    if upper_sku == "HG10K":
        return "HCG"
    if upper_sku.startswith("HA"):
        return "Hyaluronic Acid"
    if upper_sku.startswith("HM"):
        return "Humanin"
    if upper_sku.startswith("F410") or "foxo4" in signature:
        return "FOXO4"
    if upper_sku.startswith("HGHFRAGMENT") or "fragment176191" in signature:
        return "HGH Fragment 176-191"
    if upper_sku.startswith("HX") or "hexarelin" in signature:
        return "Hexarelin"
    if "igf1lr3" in signature or "igf1lr" in signature:
        return "IGF-1LR3"
    if "aod9604" in signature or signature in {"aod", "5ad", "10ad"}:
        return "AOD-9604"
    if upper_sku == "B12" or signature in {"b12", "b12vitamin"}:
        return "B12 Vitamin"
    if upper_sku.startswith("LC216") or "lipo" in signature and "b12" in signature:
        return "Lipo-C with B12"
    if upper_sku.startswith("AA") or "aseticacid" in signature or "aceticacid" in signature:
        return "Acetic Acid Water"
    if "cerebroly" in signature or "ceredroly" in signature or upper_sku.startswith("CBL"):
        return "Cerebrolysin"
    if "ghrp2" in signature or upper_sku.startswith("G2"):
        return "GHRP-2 Acetate"
    if "ghrp6" in signature or upper_sku.startswith("G6"):
        return "GHRP-6 Acetate"
    if "kisspeptin" in signature or "kisspetin" in signature or upper_sku.startswith("KS"):
        return "Kisspeptin-10"
    if "oxytocin" in signature or upper_sku.startswith("OT"):
        return "Oxytocin"

    prefix_map = [
        ("B12", "B12 Vitamin"),
        ("LC216", "Lipo-C with B12"),
        ("CBL", "Cerebrolysin"),
        ("KS", "Kisspeptin-10"),
        ("OT", "Oxytocin"),
        ("TA", "Thymosin Alpha-1"),
        ("TY", "Thymalin/Thymulin"),
        ("TSN", "Tesamorelin"),
        ("TSM", "Tesamorelin"),
        ("TER", "Teriparatide"),
        ("TBF", "TB Frag"),
        ("TB", "TB-500"),
        ("TR", "Tirzepatide"),
        ("T", "Tirzepatide"),
        ("RT", "Retatrutide"),
        ("SMO", "Sermorelin"),
        ("SM", "Semaglutide"),
        ("CGL", "Cagrilintide"),
        ("CS", "CagriSema"),
        ("CU", "GHK-Cu"),
        ("GHK", "GHK-Cu"),
        ("ET", "Epithalon"),
        ("MS", "MOTS-c"),
        ("ML", "MT-2"),
        ("MT", "MT-1"),
        ("CD", "CJC-1295 DAC"),
        ("CND", "CJC-1295 No DAC"),
        ("CJC", "CJC-1295 No DAC"),
        ("CP", "CJC-1295 No DAC + Ipamorelin"),
        ("IP", "Ipamorelin"),
        ("BC", "BPC-157"),
        ("BPC", "BPC-157"),
        ("BT", "TB-500"),
        ("BBGK", "KLOW"),
        ("BBG", "GLOW"),
        ("GLOW", "GLOW"),
        ("BB", "BPC-157 + TB-500"),
        ("NJ", "NAD+"),
        ("GTT", "Glutathione"),
        ("G5K", "HCG"),
        ("G10K", "HCG"),
        ("2S", "SS-31"),
        ("NP", "Snap-8"),
        ("PC", "PNC-27"),
        ("KPV", "KPV"),
        ("XA", "Semax"),
        ("SK", "Selank"),
        ("IG", "IGF-1LR3"),
        ("VIP", "VIP"),
        ("P41", "PT-141"),
        ("DS", "DSIP"),
        ("5AD", "AOD-9604"),
        ("10AD", "AOD-9604"),
        ("AOD", "AOD-9604"),
        ("H", "HGH 191AA"),
    ]

    # SKU prefixes are more reliable than many vendor product labels.
    for prefix, product in prefix_map:
        if upper_sku.startswith(prefix):
            return product

    if "benzylalcohol" in signature or "benzylacoh" in signature or "benzylalcoh" in signature or "bacwater" in signature or "bacwater" in signature:
        return "Bacteriostatic Water"
    if "klow" in signature or ("bpc" in signature and "ghk" in signature and "tb" in signature and "kpv" in signature):
        return "KLOW"
    if "glow" in signature or ("bpc" in signature and "ghk" in signature and "tb" in signature and "kpv" not in signature):
        return "GLOW"
    if "bpc5mgtb5" in signature or "bpc10mgtb10" in signature or signature.startswith("bb"):
        return "BPC-157 + TB-500"
    if "bpc157" in signature or re.search(r"\bbpc[- ]?157\b", name.lower()):
        return "BPC-157"
    if "tb500" in signature or "thymosinb4" in signature:
        return "TB-500"

    fixes = {
        "Samaglutide": "Semaglutide",
        "Tirzep atide": "Tirzepatide",
        "Hgh": "HGH 191AA",
        "HGH 191AA(Somatropin)": "HGH 191AA",
        "BPC157": "BPC-157",
        "TB500(Thymosin B4 Acetate)": "TB-500",
        "CJC-1295NODAC": "CJC-1295 No DAC",
        "CJC-1295DAC": "CJC-1295 DAC",
        "PEGMGF": "PEG MGF",
        "GHK-CU": "GHK-Cu",
        "GHK-Cu": "GHK-Cu",
        "VIP5": "VIP",
        "Lemon bottle": "Lemon Bottle",
        "AOD": "AOD-9604",
        "AOD9604": "AOD-9604",
        "AOD 9604": "AOD-9604",
        "Benzyl Alcoh 0.9%": "Bacteriostatic Water",
        "Benzyl Acoh 0.9%": "Bacteriostatic Water",
        "Bac Water 0.9% benzyl alcohol": "Bacteriostatic Water",
        "BACwater (ContainsBenzylAlcohol)": "Bacteriostatic Water",
        "ACETIC ACID": "Acetic Acid Water",
        "Asetic Acid water 0.6%": "Acetic Acid Water",
        "0.6% Acetic Acid Liquid": "Acetic Acid Water",
        "LC216": "Lipo-C with B12",
        "LiPO-CwithB12": "Lipo-C with B12",
        "Lipo-C with vitamins B12": "Lipo-C with B12",
        "Lipo-B": "Lipo-C with B12",
        "cerebrolysim": "Cerebrolysin",
        "cerebrolysin 60mg": "Cerebrolysin",
        "cerebrolysin 60mg *6 vials": "Cerebrolysin",
        "Ceredrolysin": "Cerebrolysin",
        "GHRP-2Acetate": "GHRP-2 Acetate",
        "GHRP-2 Acetate 5mg": "GHRP-2 Acetate",
        "GHRP-2": "GHRP-2 Acetate",
        "GHRP-6Acetate": "GHRP-6 Acetate",
        "GHRP-6 Acetate 5mg": "GHRP-6 Acetate",
        "GHRP-6 Acetate 10mg": "GHRP-6 Acetate",
        "GHRP-6": "GHRP-6 Acetate",
        "KissPeptin-10": "Kisspeptin-10",
        "Kisspetin-10": "Kisspeptin-10",
        "OxytocinAcetate": "Oxytocin",
        "Oxytocin Acetate": "Oxytocin",
        "Oxytocin Acetate*2mg": "Oxytocin",
        "BPC5mg+TB5mg": "BPC-157 + TB-500",
        "BPC10mg+TB10mg": "BPC-157 + TB-500",
        "BPC 5mg + TB 5mg": "BPC-157 + TB-500",
        "BPC 10mg + TB 10mg": "BPC-157 + TB-500",
        "BPC 5mg+TB5mg": "BPC-157 + TB-500",
        "BPC 10mg+TB10mg": "BPC-157 + TB-500",
        "BPC 5mg+Tb500 5mg": "BPC-157 + TB-500",
        "BPC 10mg+Tb500 10mg": "BPC-157 + TB-500",
        "BPC+TB": "BPC-157 + TB-500",
    }
    name = fixes.get(name, name)
    if name:
        return name
    return sku or "Unmatched Product"


def canonical_product_name(name):
    raw = ascii_clean(name)
    key = compact(raw)

    exact = {
        "adipotidefttp": "Adipotide",
        "adipotidedsip": "Adipotide",
        "ara290cibinetide": "Ara-290",
        "cagrisema5mg5mg": "CagriSema",
        "cagrisema10mg10mg": "CagriSema",
        "lc120": "Lipo-C",
        "lipoc": "Lipo-C",
        "lipocwithb12": "Lipo-C with B12",
        "lipob": "Lipo-C with B12",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcarnitine": "L-Carnitine",
        "lcamitine": "L-Carnitine",
        "sermorelinacetate": "Sermorelin",
        "foxo4moq10box": "FOXO4",
        "foxo4dri": "FOXO4",
        "wacwater": "Bacteriostatic Water",
        "hyaluronicacid": "Hyaluronic Acid",
    }
    if key in exact:
        return exact[key]

    if key.startswith("cagrisema"):
        return "CagriSema"
    if key in {"lcarnitine", "lcarnitine", "lcarnitine"} or re.fullmatch(r"lcarni?tine", key):
        return "L-Carnitine"
    if key.startswith("lipocwith") or key.startswith("lc216"):
        return "Lipo-C with B12"
    if key.startswith("lipoc"):
        return "Lipo-C"
    if key.startswith("relaxatlon") or key.startswith("relaxation"):
        return "Relaxation PM"
    if key.startswith("methonine15mgcholine") or key.startswith("methionine15mgcholine"):
        return "Lipo-C"
    if "trizepatide" in key:
        return raw.replace("Trizepatide", "Tirzepatide").replace("trizepatide", "tirzepatide")

    return raw


def normalize_spec(spec):
    text = ascii_clean(spec)
    lower = text.lower().replace(" ", "")
    lower = lower.replace("，", ",")

    plus_amounts = re.findall(r"(\d+(?:\.\d+)?)mg", lower)
    if "+" in lower and len(plus_amounts) >= 2:
        numeric = [float(amount) for amount in plus_amounts]
        if len(numeric) >= 3 and abs(sum(numeric[:-1]) - numeric[-1]) < 0.001:
            total = numeric[-1]
        else:
            total = sum(numeric)
        if total.is_integer():
            total = int(total)
        return f"{total}mg*10vials"

    # Common kit formats: "5 mg/vial, 10vial/kits", "5mg*10vials", "5mg*10".
    match = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|iu|ml)\s*(?:/vial)?(?:[,*x])?\s*(\d+)?\s*vial", lower)
    if not match:
        match = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|iu|ml)\s*[*x]\s*(\d+)", lower)
    if match:
        amount, unit, count = match.group(1), match.group(2), match.group(3) or "10"
        amount = float(amount)
        if unit == "mcg":
            amount = amount / 1000
            unit = "mg"
        if float(amount).is_integer():
            amount = int(amount)
        unit = "IU" if unit == "iu" else unit
        return f"{amount}{unit}*{count}vials"

    # Sometimes a blend has a total amount but no explicit vial count nearby.
    match = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|iu|ml)", lower)
    if match:
        amount, unit = match.group(1), match.group(2)
        amount = float(amount)
        if unit == "mcg":
            amount = amount / 1000
            unit = "mg"
        if float(amount).is_integer():
            amount = int(amount)
        unit = "IU" if unit == "iu" else unit
        return f"{amount}{unit}*10vials"

    return text


def vial_count(spec):
    match = re.search(r"\*(\d+)vials", spec.lower())
    return int(match.group(1)) if match else None


def correct_suspicious_spec(spec):
    count = vial_count(spec)
    if count == 11:
        return spec.replace("*11vials", "*10vials")
    return spec


def unit_type(spec):
    spec = ascii_clean(spec).lower()
    if "iu" in spec:
        return "IU"
    if "mcg" in spec:
        return "mcg"
    if "mg" in spec:
        return "mg"
    if "ml" in spec:
        return "vial"
    return "other"


def categories_for(name):
    text = name.lower()
    cats = []

    def add(category):
        if category not in cats:
            cats.append(category)

    if any(x in text for x in ["semaglutide", "tirzepatide", "retatrutide", "cagri", "aod", "mazdutide", "survodutide", "5-amino", "5amino", "slu-pp", "adipotide"]):
        add("Weight Loss / Metabolic")
    if any(x in text for x in ["hgh", "cjc", "ipamorelin", "tesamorelin", "sermorelin", "hexarelin", "ghrp", "igf", "mgf", "follistatin", "ace-031", "mk677", "mk-677"]):
        add("Growth Hormone / Growth Factors")
    if any(x in text for x in ["bpc", "tb-500", "tb500", "ss-31", "ara", "ghk", "glow", "klow", "cartalax", "b7-33"]):
        add("Recovery / Tissue Repair")
    if any(x in text for x in ["kpv", "ll37", "ll-37", "thym", "vip", "bronchogen", "bpc", "tb-500", "tb500", "glow", "klow"]):
        add("Anti-Inflammatory / Immune")
    if any(x in text for x in ["semax", "selank", "cerebrolysin", "p21", "p021", "pe-22-28", "pinealon", "oxytocin", "cortagen", "adamax"]):
        add("Brain / Mood / Cognitive")
    if any(x in text for x in ["dsip", "relaxation", "selank"]):
        add("Sleep / Relaxation")
    if any(x in text for x in ["ghk", "ahk", "snap", "matrixyl", "lemon", "botulinum", "hyaluronic", "mt-1", "mt-2", "skin", "hair"]):
        add("Skin / Hair / Cosmetic")
    if any(x in text for x in ["epithalon", "epitalon", "mots", "glutathione", "humanin", "foxo4", "ss-31", "aicar", "vesugen", "cardiogen"]) or "nad+" in text:
        add("Longevity / Mitochondrial / Cellular Health")
    if any(x in text for x in ["hcg", "hmg", "kiss", "gonadorelin", "hgh"]):
        add("Hormones / Fertility")
    if any(x in text for x in ["pt-141", "alprostadil", "oxytocin", "mt-2"]):
        add("Sexual Health")
    if any(x in text for x in ["b12", "l-carnitine", "carnitine", "lipo-c", "lipoc", "glutathione"]) or "nad+" in text:
        add("Injectable Nutrients / Amino Acids")
    if any(x in text for x in ["water", "bacteriostatic", "bac ", "acetic acid"]):
        add("Waters / Reconstitution")
    if any(x in text for x in ["pnc", "epo", "gdf", "crystagen", "dermorphin"]):
        add("Research / Specialty Compounds")

    return cats or ["Other / Needs Review"]


VENDORS = {
    "innopeptides": {
        "pdf": "innopeptide catalog.pdf",
        "vendorName": "Innopeptides",
        "contactName": "Loreler",
        "whatsappNumber": "+1 (231) 392-1328",
        "region": "overseas",
        "shippingOrigin": "Unknown",
        "averageDeliveryTime": "10-15 days",
        "defaultShippingCost": 0,
        "freeShippingThreshold": None,
        "paymentMethods": ["crypto", "wire"],
        "notes": "Verified vendor list updated 2026-06-28. Shipping cost not listed in provided sheet.",
    },
    "wanshun": {
        "pdf": "Peptide Suplier (WanShun).pdf",
        "vendorName": "WanShun",
        "contactName": "Sophie",
        "whatsappNumber": "+852 6729 1670",
        "region": "overseas",
        "shippingOrigin": "Hong Kong / overseas",
        "averageDeliveryTime": "15-20 days",
        "defaultShippingCost": 0,
        "freeShippingThreshold": None,
        "paymentMethods": ["all_forms"],
        "notes": "Verified vendor list notes all forms. Shipping cost not listed in provided sheet.",
    },
    "kerui-peptides": {
        "pdf": "Mia (Kerui) Price List.pdf",
        "vendorName": "Kerui Peptides",
        "contactName": "Mia",
        "whatsappNumber": "+852 44722635",
        "region": "overseas",
        "shippingOrigin": "Hong Kong / overseas",
        "averageDeliveryTime": "15-20 days",
        "defaultShippingCost": 50,
        "freeShippingThreshold": 400,
        "paymentMethods": ["crypto", "wire"],
        "notes": "Verified vendor list updated 2026-06-28. Shipping is $50, free over $400.",
    },
    "peptide-laboratory": {
        "pdf": "Peptide Lab.pdf",
        "vendorName": "Peptide Laboratory",
        "contactName": "Audrey",
        "whatsappNumber": "+852 5588 6802",
        "region": "overseas",
        "shippingOrigin": "Unknown",
        "averageDeliveryTime": "15-20 days",
        "defaultShippingCost": 60,
        "freeShippingThreshold": None,
        "paymentMethods": ["all_forms"],
        "notes": "PDF lists WhatsApp +44 7366 662602; verified vendor image lists Audrey at +852 5588 6802. Shipping cost is $60.",
    },
    "marvel-peptides": {
        "pdf": "Marvel Peptides.pdf",
        "vendorName": "Marvel Peptides",
        "contactName": "Kitty",
        "whatsappNumber": "+852 6705 9715",
        "region": "overseas",
        "shippingOrigin": "Hong Kong / overseas",
        "averageDeliveryTime": "15-20 days",
        "defaultShippingCost": 0,
        "freeShippingThreshold": None,
        "paymentMethods": ["all_forms"],
        "notes": "Retail prices imported from provided Marvel sheet.",
    },
    "mkm": {
        "pdf": "MKM Peptides Product List 05.11 (2).pdf",
        "vendorName": "MKM",
        "contactName": "Cassie",
        "whatsappNumber": "+86 176 59906901",
        "region": "overseas",
        "shippingOrigin": "China",
        "averageDeliveryTime": "7-15 days",
        "defaultShippingCost": 50,
        "freeShippingThreshold": 700,
        "paymentMethods": ["all_forms"],
        "notes": "Shipping: $50 line, $70 FedEx, free over $700. Calculator uses $50 line shipping by default.",
    },
    "lilipeptide": {
        "pdf": "Lilipeptide- Luna.pdf",
        "vendorName": "Lilipeptide",
        "contactName": "Mia Becky",
        "whatsappNumber": "+852 6556 6430",
        "region": "overseas",
        "shippingOrigin": "Hong Kong / overseas",
        "averageDeliveryTime": "15-20 days",
        "defaultShippingCost": 0,
        "freeShippingThreshold": None,
        "paymentMethods": ["all_forms"],
        "notes": "Retail prices for under 10 kits imported from Luna sheet. Shipping cost not listed in provided sheet.",
    },
}


def rows_from_table(vendor_id, table):
    rows = []
    current = {0: "", 1: "", 6: ""}
    for raw in table:
        row = [ascii_clean(cell) for cell in raw]
        if not any(row):
            continue
        joined = " ".join(row).lower()
        if any(x in joined for x in ["price list", "cat. no", "product name", "whatsapp", "retail moq", "shipping cost", "payment method", "lead time", "notes:"]):
            continue

        if vendor_id == "marvel-peptides":
            groups = [(0, 1, 2, 3), (6, 7, 8, 9)]
            for idx, name_idx, spec_idx, price_idx in groups:
                sku = valid_sku(row[idx] if idx < len(row) else "")
                if name_idx < len(row) and row[name_idx]:
                    current[idx] = normalize_name(row[name_idx], sku)
                name = normalize_name(current.get(idx, ""), sku)
                price = parse_price(row[price_idx] if price_idx < len(row) else "")
                spec = row[spec_idx] if spec_idx < len(row) else ""
                if sku and price is not None and spec:
                    rows.append((sku, name, spec, price))
            continue

        if vendor_id == "mkm":
            name, sku, spec, price = (row + ["", "", "", ""])[:4]
            if name:
                current[0] = normalize_name(name, sku)
            sku = valid_sku(sku)
            price = parse_price(price)
            if sku and price is not None:
                rows.append((sku, normalize_name(current.get(0, ""), sku), spec, price))
            continue

        if vendor_id == "lilipeptide":
            _, sku, name, spec, price = (row + ["", "", "", "", ""])[:5]
            if name:
                current[0] = normalize_name(name, sku)
            sku = valid_sku(sku)
            price = parse_price(price)
            if sku and price is not None:
                rows.append((sku, normalize_name(current.get(0, ""), sku), spec, price))
            continue

        if vendor_id == "kerui-peptides":
            sku, name, spec, price = (row + ["", "", "", ""])[:4]
            if name:
                current[0] = normalize_name(name, sku)
            sku = valid_sku(sku) or valid_sku(current[0])
            price = parse_price(price)
            if price is not None and spec:
                rows.append((sku or slug(current.get(0, ""))[:12], normalize_name(current.get(0, ""), sku), spec, price))
            continue

        # Standard 4-5 column tables: sku, name, spec, usd/price.
        sku = valid_sku(row[0] if row else "")
        name = row[1] if len(row) > 1 else ""
        spec = row[2] if len(row) > 2 else ""
        price_cell = row[3] if len(row) > 3 else ""
        if vendor_id == "peptide-laboratory":
            name, sku, spec, price_cell = (row + ["", "", "", ""])[:4]
            sku = valid_sku(sku)
        if name:
            current[0] = normalize_name(name, sku)
        price = parse_price(price_cell)
        if sku and price is not None and spec:
            rows.append((sku, normalize_name(current.get(0, ""), sku), spec, price))
    return rows


def extract_vendor_prices(vendor_id, meta):
    path = PDF_DIR / meta["pdf"]
    found = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                found.extend(rows_from_table(vendor_id, table))
    dedup = {}
    for sku, name, spec, price in found:
        key = (sku, name, spec, price)
        dedup[key] = (sku, name, spec, price)
    return list(dedup.values())


def main():
    products = {}
    prices = []
    vendors = []
    warnings = []
    now = "2026-06-29T00:00:00.000Z"
    updated = "2026-06-28"

    for vendor_id, meta in VENDORS.items():
        vendors.append({
            "id": vendor_id,
            "vendorName": meta["vendorName"],
            "contactName": meta["contactName"],
            "whatsappNumber": meta["whatsappNumber"],
            "region": meta["region"],
            "shippingOrigin": meta["shippingOrigin"],
            "averageDeliveryTime": meta["averageDeliveryTime"],
            "defaultShippingCost": meta["defaultShippingCost"],
            "freeShippingThreshold": meta["freeShippingThreshold"],
            "paymentMethods": meta["paymentMethods"],
            "cryptoDiscountType": "none",
            "cryptoDiscountValue": 0,
            "notes": meta["notes"],
            "active": True,
            "lastUpdatedAt": updated,
        })
        for sku, name, spec, price in extract_vendor_prices(vendor_id, meta):
            if price < 5:
                continue
            raw_name = name
            name = canonical_product_name(normalize_name(name, sku))
            raw_spec = spec
            spec = normalize_spec(spec)
            if name == "Bacteriostatic Water":
                spec = spec.replace("mg*", "ml*")
            if name == "Acetic Acid Water":
                spec = spec.replace("mg*", "ml*")
            if name == "Lipo-C with B12":
                spec = "10ml*10vials"
            if name == "Lipo-C" and compact(sku).startswith("lc120"):
                spec = "10ml*10vials"
            if name == "Cerebrolysin" and ("6vial" in compact(raw_spec) or "6vial" in compact(raw_name) or "cbl60" in compact(sku)):
                spec = "60mg*6vials"
            corrected_spec = correct_suspicious_spec(spec)
            if corrected_spec != spec:
                warnings.append({
                    "vendorId": vendor_id,
                    "vendorName": meta["vendorName"],
                    "sku": sku,
                    "productName": name,
                    "rawName": raw_name,
                    "rawSpec": raw_spec,
                    "extractedSpec": spec,
                    "correctedSpec": corrected_spec,
                    "message": "Suspicious kit count corrected from 11 vials to 10 vials. Review against source PDF.",
                })
                spec = corrected_spec
            count = vial_count(spec)
            if count and count not in {1, 6, 10}:
                warnings.append({
                    "vendorId": vendor_id,
                    "vendorName": meta["vendorName"],
                    "sku": sku,
                    "productName": name,
                    "rawName": raw_name,
                    "rawSpec": raw_spec,
                    "extractedSpec": spec,
                    "correctedSpec": spec,
                    "message": f"Unusual kit count detected: {count} vials. Review against source PDF.",
                })
            product_id = slug(name)
            products.setdefault(product_id, {
                "id": product_id,
                "masterName": name,
                "displayName": name,
                "aliases": sorted({name, sku}),
                "categories": categories_for(name),
                "unitType": unit_type(spec),
                "notes": "",
                "active": True,
                "createdAt": now,
                "updatedAt": now,
            })
            products[product_id]["aliases"] = sorted(set(products[product_id]["aliases"] + [sku]))
            prices.append({
                "id": f"{vendor_id}-{slug(sku)}-{slug(spec)[:18]}",
                "vendorId": vendor_id,
                "productId": product_id,
                "vendorProductName": name,
                "sku": sku,
                "mgOrAmountPerVial": spec,
                "unitType": unit_type(spec),
                "vialsPerKit": 10,
                "kitPrice": price,
                "currency": "USD",
                "active": True,
                "priceListId": f"{vendor_id}-2026-06-29",
                "lastUpdatedAt": updated,
                "notes": f"Imported from {meta['pdf']}",
            })

    vendors.extend([
        {
            "id": "instantpeptides",
            "vendorName": "InstantPeptides.com",
            "contactName": "",
            "whatsappNumber": "",
            "region": "domestic",
            "shippingOrigin": "US",
            "averageDeliveryTime": "2-4 days",
            "defaultShippingCost": 0,
            "freeShippingThreshold": None,
            "paymentMethods": ["all_forms"],
            "cryptoDiscountType": "none",
            "cryptoDiscountValue": 0,
            "notes": "Verified vendor list entry. No price sheet provided in this import.",
            "active": True,
            "lastUpdatedAt": updated,
        },
        {
            "id": "crushresearch",
            "vendorName": "CrushResearch.com",
            "contactName": "",
            "whatsappNumber": "",
            "region": "domestic",
            "shippingOrigin": "US",
            "averageDeliveryTime": "2-4 days",
            "defaultShippingCost": 0,
            "freeShippingThreshold": None,
            "paymentMethods": ["all_forms"],
            "cryptoDiscountType": "none",
            "cryptoDiscountValue": 0,
            "notes": "Limited testing history list. No price sheet provided.",
            "active": False,
            "lastUpdatedAt": updated,
        },
        {
            "id": "ethospeptideresearch",
            "vendorName": "EthosPeptideResearch.com",
            "contactName": "",
            "whatsappNumber": "",
            "region": "domestic",
            "shippingOrigin": "US",
            "averageDeliveryTime": "2-4 days",
            "defaultShippingCost": 0,
            "freeShippingThreshold": None,
            "paymentMethods": ["all_forms"],
            "cryptoDiscountType": "none",
            "cryptoDiscountValue": 0,
            "notes": "Limited testing history list. No price sheet provided.",
            "active": False,
            "lastUpdatedAt": updated,
        },
    ])

    source_counts = {}
    for price in prices:
        source_counts[price["vendorId"]] = source_counts.get(price["vendorId"], 0) + 1

    output = (
        "import type { Product, Vendor, VendorPriceItem } from '../lib/types';\n\n"
        f"export const realVendors: Vendor[] = {json.dumps(vendors, indent=2)};\n\n"
        f"export const realProducts: Product[] = {json.dumps(list(products.values()), indent=2)};\n\n"
        f"export const realPrices: VendorPriceItem[] = {json.dumps(prices, indent=2)};\n\n"
        f"export const realImportWarnings = {json.dumps(warnings, indent=2)};\n\n"
        f"export const realSeedImportSummary = {json.dumps({'vendors': len(vendors), 'products': len(products), 'prices': len(prices), 'sourceCounts': source_counts}, indent=2)};\n"
    )
    output = output.replace(": true", ": true").replace(": false", ": false").replace(": null", ": undefined")
    OUT.write_text(output, encoding="utf-8")
    print(json.dumps({"vendors": len(vendors), "products": len(products), "prices": len(prices), "warnings": len(warnings), "sourceCounts": source_counts}, indent=2))


if __name__ == "__main__":
    main()
