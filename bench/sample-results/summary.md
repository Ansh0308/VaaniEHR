# Benchmark run summary

Run at 2026-10-24T14:22:00+00:00, split `all`, dataset hash `d36a303975fc`, split hash `4f2d6a440b54`, language model `nvidia/nemotron-3.5-super-vl:free` (mock).

## ASR x extraction

| ASR | Variant | N | Fact P | Fact R | Fact F1 | Negation F1 | Hallucination | WER | CER | Medicine acc. |
|---|---|---|---|---|---|---|---|---|---|---|
| gold | plain | 3 | 88.9% | 100.0% | 94.1% | 66.7% | 11.1% | n/a | n/a | 100.0% |
| gold | constrained | 3 | 88.9% | 100.0% | 94.1% | 66.7% | 11.1% | n/a | n/a | 100.0% |
| gold | grounded | 3 | 100.0% | 100.0% | 100.0% | 66.7% | 0.0% | n/a | n/a | 100.0% |

Confidence note: N = 3 case(s), 0 with audio; one speaker / acted data; a protocol demonstration, not a result. No confidence interval is claimed. Synthetic fixtures are included: they only exercise the code.

## Question engines (TOY pathways only)

| Engine | Status | N | Top-1 | Top-3 | Median questions to top-3 | Red flags seeded | Red-flag recall |
|---|---|---|---|---|---|---|---|
| rules-only | toy pathways only | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| llm-only | not built | - | n/a | n/a | n/a | - | n/a |
| hybrid | not built | - | n/a | n/a | n/a | - | n/a |

These question-engine numbers come from FAKE toy pathways and say nothing about real conditions. `llm-only` and `hybrid` are not built. Confidence note: N = 3 case(s), 0 with audio; one speaker / acted data; a protocol demonstration, not a result. No confidence interval is claimed. Synthetic fixtures are included: they only exercise the code.

## Reproduce

Rerun the same command: every stage result is cached by engine + version + prompt hash + input hash, so a rerun costs nothing.
