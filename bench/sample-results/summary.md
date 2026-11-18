# Benchmark run summary

Run at 2026-11-18T12:00:13+00:00, split `all`, dataset hash `d36a303975fc`, split hash `4f2d6a440b54`, language model `nvidia/nemotron-3.5-super-vl:free` (openai_compatible).

## ASR x extraction

| ASR | Variant | N | Fact P | Fact R | Fact F1 | Negation F1 | Hallucination | WER | CER | Medicine acc. |
|---|---|---|---|---|---|---|---|---|---|---|
| gold | plain | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| gold | constrained | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| gold | grounded | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

Confidence note: N = 3 case(s), 0 with audio; one speaker / acted data; a protocol demonstration, not a result. No confidence interval is claimed. Synthetic fixtures are included: they only exercise the code.

## Question engines (TOY pathways only)

| Engine | Status | Provider | Model | Validity | Abstain | N | Top-1 | Top-3 | Median questions to top-3 | Red flags seeded | Red-flag recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rules-only | toy pathways only | rules-engine | deterministic | 100.0% | 0 | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| llm-only | toy pathways only | deterministic-mock-plain-llm | mock-toy-v1 | 100.0% | 0 | 3 | 100.0% | 100.0% | 0 | 1 | 0.0% |
| hybrid | toy pathways only | deterministic-mock-hybrid | mock-toy-v1 | 100.0% | 0 | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |

These question-engine numbers come from FAKE toy pathways and say nothing about real conditions. Rules-Only, Plain-LLM, and Hybrid baselines evaluated using deterministic synthetic mock completion. Confidence note: N = 3 case(s), 0 with audio; one speaker / acted data; a protocol demonstration, not a result. No confidence interval is claimed. Synthetic fixtures are included: they only exercise the code.

## ASR Performance by Explicit Language Annotation

| Language Group | Segments | Reference Words | Word Errors | Segment WER | Reference Chars | Char Errors | Segment CER |
|---|---|---|---|---|---|---|---|
| `en` | 7 | 42 | 0 | 0.0% | 164 | 0 | 0.0% |
| `gu` | 2 | 13 | 0 | 0.0% | 45 | 0 | 0.0% |

> Language breakdowns rely strictly on explicit segment annotations ('gu', 'hi', 'en', 'mixed'). Script detection was not used to assign spoken language. Results on small synthetic/acted test cases are protocol demonstrations and not statistically meaningful population performance.

## Additional Verification Inputs

- **FHIR Validation (M-11)**:
  - Validation Level: HL7 validator 7.0.3 against ABDM FHIR IG ndhm.in 6.5.0 profile & terminology definitions
  - Source: `D:/CODES/ClinicOS/VaaniEHR/data/fhir/out/golden-summary.json` (last modified: 2026-10-23T07:45:35.112782+00:00)
  - Provenance: Historical precomputed offline fixture summary from CI (not newly executed during benchmark run)
  - Total Bundles: 8 (Good: 5, Broken: 3)
  - Good Bundle Pass Rate: 100.0%
  - Broken Bundle Catch Rate: 100.0%
  - Disclaimer: Automated verification against synthetic golden fixtures only; formal ABDM/NRCeS production sandboxing has not been conducted.

Confidence note: N = 3 case(s), 0 with audio; one speaker / acted data; a protocol demonstration, not a result. No confidence interval is claimed. Synthetic fixtures are included: they only exercise the code.

## Reproduce

Rerun the same command: every stage result is cached by engine + version + prompt hash + input hash, so a rerun costs nothing.
