from __future__ import annotations

import json

from handoffkit.tools.medical import (
    clinical_trials_search,
    dailymed_drug_search,
    medical_toolkit,
    pmc_search,
    pubmed_abstract_search,
    pubmed_search,
)


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class FakeResponseText:
    def __init__(self, payload: str) -> None:
        self.payload = payload

    def __enter__(self) -> FakeResponseText:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload.encode("utf-8")


def test_pubmed_search_summarizes_esearch_and_esummary(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        if "esearch.fcgi" in request.full_url:
            return FakeResponse({"esearchresult": {"idlist": ["1"]}})
        return FakeResponse(
            {
                "result": {
                    "1": {
                        "title": "Case report",
                        "fulljournalname": "Journal",
                        "pubdate": "2026",
                    }
                }
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = pubmed_search.run(query="asthma", max_results=1)
    assert result["results"][0]["pmid"] == "1"
    assert result["results"][0]["url"].endswith("/1/")


def test_pmc_search_summarizes_esearch_and_esummary(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        if "esearch.fcgi" in request.full_url:
            return FakeResponse({"esearchresult": {"idlist": ["123"]}})
        return FakeResponse(
            {
                "result": {
                    "123": {
                        "title": "Open access case",
                        "fulljournalname": "PMC Journal",
                        "pubdate": "2026",
                    }
                }
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = pmc_search.run(query="rare disease", max_results=1)
    assert result["results"][0]["pmcid"] == "PMC123"
    assert "pmc.ncbi.nlm.nih.gov" in result["results"][0]["url"]


def test_pubmed_abstract_search_fetches_abstracts(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        if "esearch.fcgi" in request.full_url:
            return FakeResponse({"esearchresult": {"idlist": ["1"]}})
        return FakeResponseText(
            """
            <PubmedArticleSet>
              <PubmedArticle>
                <MedlineCitation>
                  <PMID>1</PMID>
                  <Article>
                    <ArticleTitle>Rare case</ArticleTitle>
                    <Journal><Title>Journal</Title></Journal>
                    <Abstract><AbstractText>Important abstract clue.</AbstractText></Abstract>
                  </Article>
                </MedlineCitation>
              </PubmedArticle>
            </PubmedArticleSet>
            """
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = pubmed_abstract_search.run(query="rare", max_results=1)
    assert result["results"][0]["abstract"] == "Important abstract clue."


def test_clinical_trials_search_summarizes_studies(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        return FakeResponse(
            {
                "studies": [
                    {
                        "protocolSection": {
                            "identificationModule": {
                                "nctId": "NCT1",
                                "briefTitle": "Trial",
                            },
                            "statusModule": {"overallStatus": "RECRUITING"},
                            "designModule": {"studyType": "INTERVENTIONAL"},
                            "conditionsModule": {"conditions": ["Asthma"]},
                        }
                    }
                ]
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = clinical_trials_search.run(condition="asthma", max_results=1)
    assert result["results"][0]["nct_id"] == "NCT1"
    assert result["results"][0]["status"] == "RECRUITING"


def test_dailymed_drug_search_summarizes_labels(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        return FakeResponse(
            {
                "data": [
                    {
                        "setid": "abc",
                        "title": "IBUPROFEN TABLET",
                        "published_date": "Jul 03, 2026",
                    }
                ]
            }
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = dailymed_drug_search.run(drug_name="ibuprofen", max_results=1)
    assert result["results"][0]["setid"] == "abc"
    assert "dailymed" in result["results"][0]["url"]


def test_medical_toolkit_contains_public_lookup_tools() -> None:
    names = {tool.name for tool in medical_toolkit()}
    assert names == {
        "pubmed_search",
        "pubmed_abstract_search",
        "pmc_search",
        "clinical_trials_search",
        "dailymed_drug_search",
    }
