"""Evidence lookup tools for medical benchmark and research workflows.

These tools retrieve public reference data. They do not diagnose, treat, or
replace clinical judgment.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from handoffkit.tool import tool

NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
CLINICALTRIALS_API = "https://clinicaltrials.gov/api/v2/studies"
DAILYMED_API = "https://dailymed.nlm.nih.gov/dailymed/services/v2"


def _get_json(url: str, timeout: float = 20.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "handoffkit/1.3 medical-tools",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {"data": payload}


def _clip(value: str, limit: int = 240) -> str:
    value = " ".join(value.split())
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _get_text(url: str, timeout: float = 20.0) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/xml,application/xml,text/plain",
            "User-Agent": "handoffkit/1.3 medical-tools",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


@tool
def pubmed_search(query: str, max_results: int = 5) -> dict[str, Any]:
    """Search PubMed with NCBI E-utilities and return brief article summaries."""
    max_results = max(1, min(max_results, 10))
    term = urllib.parse.quote(query)
    search = _get_json(
        f"{NCBI_EUTILS}/esearch.fcgi?db=pubmed&term={term}&retmode=json&retmax={max_results}"
    )
    ids = search.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return {"query": query, "count": 0, "results": []}
    summary = _get_json(
        f"{NCBI_EUTILS}/esummary.fcgi?db=pubmed&id={','.join(ids)}&retmode=json"
    )
    result_map = summary.get("result", {})
    rows = []
    for pmid in ids:
        item = result_map.get(str(pmid), {})
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "pmid": str(pmid),
                "title": item.get("title", ""),
                "journal": item.get("fulljournalname", item.get("source", "")),
                "pubdate": item.get("pubdate", ""),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            }
        )
    return {"query": query, "count": len(rows), "results": rows}


@tool
def pubmed_abstract_search(query: str, max_results: int = 3) -> dict[str, Any]:
    """Search PubMed and return compact article abstracts when available."""
    max_results = max(1, min(max_results, 5))
    term = urllib.parse.quote(query)
    search = _get_json(
        f"{NCBI_EUTILS}/esearch.fcgi?db=pubmed&term={term}&retmode=json&retmax={max_results}"
    )
    ids = search.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return {"query": query, "count": 0, "results": []}
    xml_text = _get_text(
        f"{NCBI_EUTILS}/efetch.fcgi?db=pubmed&id={','.join(ids)}&retmode=xml"
    )
    root = ET.fromstring(xml_text)
    rows = []
    for article in root.findall(".//PubmedArticle"):
        pmid = article.findtext(".//PMID") or ""
        title = "".join(article.findtext(".//ArticleTitle") or "").strip()
        abstract_parts = [
            "".join(node.itertext()).strip()
            for node in article.findall(".//Abstract/AbstractText")
        ]
        abstract = _clip(" ".join(part for part in abstract_parts if part), 900)
        journal = (
            article.findtext(".//Journal/Title")
            or article.findtext(".//ISOAbbreviation")
            or ""
        )
        rows.append(
            {
                "pmid": pmid,
                "title": _clip(title, 260),
                "journal": journal,
                "abstract": abstract,
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            }
        )
    return {"query": query, "count": len(rows), "results": rows}


@tool
def pmc_search(query: str, max_results: int = 5) -> dict[str, Any]:
    """Search PubMed Central with NCBI E-utilities and return article summaries."""
    max_results = max(1, min(max_results, 10))
    term = urllib.parse.quote(query)
    search = _get_json(
        f"{NCBI_EUTILS}/esearch.fcgi?db=pmc&term={term}&retmode=json&retmax={max_results}"
    )
    ids = search.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return {"query": query, "count": 0, "results": []}
    summary = _get_json(
        f"{NCBI_EUTILS}/esummary.fcgi?db=pmc&id={','.join(ids)}&retmode=json"
    )
    result_map = summary.get("result", {})
    rows = []
    for pmcid in ids:
        item = result_map.get(str(pmcid), {})
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "pmcid": f"PMC{pmcid}",
                "title": item.get("title", ""),
                "journal": item.get("fulljournalname", item.get("source", "")),
                "pubdate": item.get("pubdate", ""),
                "url": f"https://pmc.ncbi.nlm.nih.gov/articles/PMC{pmcid}/",
            }
        )
    return {"query": query, "count": len(rows), "results": rows}


@tool
def clinical_trials_search(condition: str, max_results: int = 5) -> dict[str, Any]:
    """Search ClinicalTrials.gov v2 studies by condition."""
    max_results = max(1, min(max_results, 10))
    params = urllib.parse.urlencode(
        {"query.cond": condition, "pageSize": max_results, "format": "json"}
    )
    payload = _get_json(f"{CLINICALTRIALS_API}?{params}")
    rows = []
    for study in payload.get("studies", [])[:max_results]:
        protocol = study.get("protocolSection", {}) if isinstance(study, dict) else {}
        ident = protocol.get("identificationModule", {})
        status = protocol.get("statusModule", {})
        design = protocol.get("designModule", {})
        conditions = protocol.get("conditionsModule", {})
        rows.append(
            {
                "nct_id": ident.get("nctId", ""),
                "title": ident.get("briefTitle", ""),
                "status": status.get("overallStatus", ""),
                "study_type": design.get("studyType", ""),
                "conditions": conditions.get("conditions", []),
                "url": f"https://clinicaltrials.gov/study/{ident.get('nctId', '')}",
            }
        )
    return {"condition": condition, "count": len(rows), "results": rows}


@tool
def dailymed_drug_search(drug_name: str, max_results: int = 5) -> dict[str, Any]:
    """Search DailyMed drug labels by drug name."""
    max_results = max(1, min(max_results, 10))
    params = urllib.parse.urlencode(
        {"drug_name": drug_name, "page": 1, "pageSize": max_results}
    )
    payload = _get_json(f"{DAILYMED_API}/spls.json?{params}")
    rows = []
    for item in payload.get("data", [])[:max_results]:
        if not isinstance(item, dict):
            continue
        setid = str(item.get("setid", ""))
        rows.append(
            {
                "setid": setid,
                "title": _clip(str(item.get("title", ""))),
                "published_date": item.get("published_date", ""),
                "url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}",
            }
        )
    return {"drug_name": drug_name, "count": len(rows), "results": rows}


def medical_toolkit() -> list[Any]:
    """Return built-in public medical evidence lookup tools."""
    return [
        pubmed_search,
        pubmed_abstract_search,
        pmc_search,
        clinical_trials_search,
        dailymed_drug_search,
    ]
