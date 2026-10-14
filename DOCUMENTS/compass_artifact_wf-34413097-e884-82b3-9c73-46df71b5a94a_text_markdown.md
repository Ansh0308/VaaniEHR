# VaaniEHR — Research Dossier, SRS Inputs and PRD (Build-vs-Reuse Edition)

**Bottom line:** VaaniEHR can be built in about 300 hours only if you reuse almost everything except the parts that make it different. Those parts are the guideline-grounded question engine (M3), the safety-rule layer (M4) and the Gujarati benchmark. For the rest: use Sarvam Saaras (API) as the main ASR and AI4Bharat IndicConformer/IndicWhisper (MIT) as the open baseline, the NRCeS FHIR IG v6.5.0 with the HAPI/HL7 validator for M6, ABDM V3 sandbox APIs for ABHA (M1), the Meta WhatsApp Cloud API with a Gujarati ("gu") template for M7, and NLEM 2022 plus an NRCeS SNOMED CT affiliate licence for M1 (medicine master). Apply for the accounts and licences now, because sandbox and licence lead times are your biggest schedule risk.

## TL;DR

- **Reuse the commodity layers; build only the differentiators.** ASR (Sarvam Saaras V4 at ₹30/hour, or IndicConformer MIT), FHIR (NRCeS IG 6.5.0 + HAPI), ABDM (V3 sandbox + Bahmni India/Nirmitee references), messaging (WhatsApp Cloud API) and evaluation (jiwer, Eka KARMA/medical ASR dataset) all exist. The STW-grounded question engine, the safety rules and a Gujarati acted-consultation benchmark do not exist anywhere public. That gap is your contribution.
- **Licences are the hidden trap.** DDInter (drug interactions) is CC BY-NC-SA 4.0.\[1\] Eka's Parrotlet-e is CC-BY-SA-4.0. SNOMED CT needs an NRCeS affiliate licence (free in India).\[2\] Scraped Indian brand datasets on Kaggle have unclear provenance. All are fine for a non-commercial research prototype, but each must be recorded in the SRS and in an SBOM, which the CDSCO 2026 MDSW guidance now expects.\[3\]
- **Regulatory framing is settled enough to write the SRS.** The CDSCO Guidance on Medical Device Software (CDSCO/MD/GD/MDSW/01/2026, 21 July 2026) is interpretive guidance under MDR 2017 and requires an intended-use statement, a QMS-style lifecycle and an SBOM.\[4\]\[5\]\[6\] Under the DPDP Rules 2025 (notified 13 November 2025), the Consent Manager framework starts 13 November 2026 and the substantive duties start 13 May 2027.\[7\] Position VaaniEHR as a research prototype that only "informs" clinical management, with mandatory doctor sign-off.\[6\]

---

## Key Findings

1. **ASR is solved enough to reuse, but Gujarati medical accuracy is not.** On the official Vistaar table, IndicWhisper's Gujarati WER is 17.8% (Kathbath), 23.5% (FLEURS) and 33.2% (MUCS), averaging 22.8%.\[8\] Those are general-domain numbers. No published Gujarati *medical* WER was found. Eka's medical scribe lists Indian English, Hindi, Marathi, Kannada and Telugu but not Gujarati, and Eka's open Parrotlet-a-en-5b model is English-only.\[9\]\[10\] A Gujarati medical ASR benchmark would therefore be a genuine contribution.
2. **Sarvam is the pragmatic primary ASR.** It costs ₹30/hour (₹45 with diarization), is billed per second and comes with ₹100 free credit.\[11\]\[12\] Saaras V4 was released on 25 September 2026; MarkTechPost reports it is served only through Sarvam's API (`model="saaras:v4"`) and that "weights are not public". MarkTechPost's comparison table lists keyterm biasing of "up to 50 terms" (useful for medicine names) and a reported 16.03% WER on IndicContextEval with keyword prompting. V4 also offers a code-mix output mode, WebSocket streaming with a first token under 150 ms, REST for clips up to 30 s, and batch jobs up to 2 h. At about 10 minutes per consultation, 300 acted consultations come to about 50 audio hours: roughly ₹1,500 at base rate or ₹2,250 with diarization.
3. **ABDM V3 is the current API generation, but sandbox behaviour is uneven.** Nirmitee's ABDM v3 migration guide states that "NHA's official ABDM Wrapper has migrated to V3, and v0.5 gateway endpoints increasingly return 403 errors". In the Nirmitee-tech ABDM V3 Postman collection README on GitHub, the HIP-initiated endpoints `/v3/token/generate-token`, `/hip/v3/link/carecontext` and `/hip/v3/link/context/notify` are marked "403", while the user-initiated linking callbacks are marked "Working". This supports keeping M2 (care-context linking) as a stretch goal.
4. **The NRCeS FHIR IG 6.5.0 (package ndhm.in, FHIR 4.0.1, generated 2025-05-08) is the target.**\[13\]\[14\]\[15\]\[16\] It includes OPConsultRecord, PrescriptionRecord, MedicationRequest, Patient, Practitioner and the other profiles you need.\[14\]\[17\]
5. **ICMR STWs are one-page PDFs, not machine-readable rules.**\[18\]\[19\] You will have to hand-encode about 5 STWs into decision trees. That is the core intellectual work of M3, and it is what makes your rules-only vs LLM-only vs hybrid comparison meaningful.
6. **No open Indian drug-interaction dataset with a permissive licence was found.** DDInter 2.0 is the best fit for M4. According to Tian et al. (Nucleic Acids Research 2025;53(D1):D1356–D1362, doi:10.1093/nar/gkae726), it covers 2,310 drugs with 302,516 drug-drug interaction records and 6,033 therapeutic duplication interactions. It is non-commercial.

---

## 1. ASR / Speech (M2)

| Resource | What it is | Link | Licence | Last activity | How VaaniEHR uses it | Recommendation |
|---|---|---|---|---|---|---|
| Sarvam Saaras V4 / Saarika (API) | Indic STT for 22 Indian languages + English, with transcribe/translate/verbatim/translit/codemix modes\[20\]\[21\] | https://docs.sarvam.ai/api/getting-started/pricing | Commercial API | V4 announced Sep 2026 | Primary streaming ASR for Gu/Hi/En code-switched speech; keyterm biasing with NLEM names | **Primary pick** |
| AI4Bharat IndicConformer-600M multilingual | Hybrid CTC+RNNT Conformer for 22 languages incl. Gujarati\[22\] | https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual | MIT (model card) | HF collection updated Mar 2 | Open-source baseline and offline fallback | **Baseline pick.** Note: one 2026 arXiv paper describes it as "gated" on HF, so check access when you download\[23\] |
| IndicConformer repo (monolingual models + AI4Bharat NeMo) | Training/inference code, per-language models incl. gu\[24\] | https://github.com/AI4Bharat/IndicConformerASR | MIT | Active | Gujarati-only model for comparison | Alternative |
| Quantized IndicConformer (ONNX int8) | Community CPU-friendly quantization\[25\] | https://huggingface.co/atharva-again/indic-conformer-600m-quantized | Inherits upstream (verify) | — | GPU-free CPU inference on a laptop | Good for a demo without a GPU; community build, so unverified quality |
| Vistaar / IndicWhisper | 59 benchmarks, 12 languages, 10,700 h of training data; Whisper fine-tunes\[8\] | https://github.com/AI4Bharat/vistaar | MIT | Paper Interspeech 2023 | Benchmark protocol and Gujarati WER baselines | Use for the evaluation chapter |
| Eka Medical ASR Evaluation Dataset | 3,900+ medical audio clips (entities, sentences, conversations)\[26\] | https://huggingface.co/datasets/ekacare/eka-medical-asr-evaluation-dataset | MIT | Updated Jul 30, 2025\[27\] | Medicine-name accuracy test for English/Hindi | **Reuse** for the medical-term WER method |
| Eka KARMA-OpenMedEvalKit | Medical AI eval toolkit incl. semantic WER and entity WER\[28\] | https://www.eka.care/services/introducing-karma-openmedevalkit-an-open-source-framework-for-medical-ai-evaluation | Open source (licence not confirmed on repo) | 2025 | Entity-WER metric design | Reuse the metric definitions |
| Eka public datasets collection | ASR, clinical note, IndicMTEB, protocol QnA datasets\[27\] | https://huggingface.co/collections/ekacare/ekacare-medical-public-datasets | Per-dataset | Updated 2026 | `indian_protocols_based_clinical_QnA` for M3 testing | Reuse |
| Parrotlet-e | Indic medical embedding model aligned to SNOMED CT/UMLS, 12 Indic languages + English\[29\] | https://huggingface.co/ekacare/parrotlet-e | CC-BY-SA-4.0 | Nov 2025 | Map spoken Gujarati/Hindi symptom and medicine mentions to SNOMED concepts | **Strong pick** for entity linking (share-alike applies) |
| faster-whisper | CTranslate2 Whisper re-implementation\[30\] | https://github.com/SYSTRAN/faster-whisper | MIT | v1.2.1 (Oct 2025)\[31\] | CPU Whisper baseline | Baseline |
| whisper.cpp | C/C++ Whisper inference | https://github.com/ggml-org/whisper.cpp | MIT | v1.9.3, Aug 2026\[32\] | Fully local fallback | Optional |
| Silero VAD | Voice activity detection | https://github.com/snakers4/silero-vad | MIT | Active (Sep 2026) | Chunk audio before ASR; cut silence cost | **Reuse** |
| pyannote-audio | Speaker diarization toolkit | https://github.com/pyannote/pyannote-audio | MIT (code; pretrained pipelines may need HF terms acceptance — unverified) | 4.0.7 (2026)\[33\] | Doctor vs patient turn separation | Use Sarvam's ₹45/h diarization instead to save time |
| Bhashini / ULCA | Government Indic speech/translation APIs | Not verified in this pass (search "Bhashini ULCA API") | Gov terms | — | Free alternative ASR/translation | Secondary; unverified onboarding time |
| IndicVoices | Large Indic speech dataset | Not verified in this pass (cited in the arXiv 2512.10967 bibliography)\[34\] | — | — | Possible fine-tuning data | Out of scope for 300 h |

**Judgement:** Use Sarvam for the product path and IndicConformer for the open baseline, and report both. Do not fine-tune anything. Budget roughly ₹2,500 for ASR.

## 2. Medical NLP, Extraction and LLM Tooling

| Resource | What it is | Link | Licence | Last activity | Use in VaaniEHR | Recommendation |
|---|---|---|---|---|---|---|
| OpenScribe | Open-source AI scribe: Whisper (whisper.cpp) + Claude/Ollama notes | https://github.com/sammargolis/OpenScribe | MIT | Active | Reference pipeline (ingest → transcribe → LLM → note editor) | **Study / borrow architecture**\[35\] |
| FreeScribe (ClinicianFOCUS) | Whisper + local LLM SOAP scribe, consent-first workflow | https://github.com/ClinicianFOCUS/FreeScribe | Not confirmed | Active | Consent-before-record UX pattern | Study |
| scribeHC | Expo + Next.js + FastAPI scribe with OpenAI APIs | https://github.com/trevorpfiz/scribeHC | Not confirmed | — | FastAPI audio-service structure | Study |
| Awesome-Medical-Scribe-AI | Curated list (updated Aug 2026) | https://github.com/ishandutta2007/Awesome-Medical-Scribe-AI | List | Aug 2026 | Competitor/related-work table for the report | Use for literature review\[36\] |
| medspaCy | Clinical NLP incl. ConText negation/assertion\[37\] | https://github.com/medspacy/medspacy | MIT | Jun 2026 (v1.3.1)\[38\]\[39\] | Negation baseline on English/translated text | Baseline only (English-centric) |
| Outlines | Constrained/structured generation\[40\] | https://github.com/dottxt-ai/outlines | Apache-2.0 | Sep 2026 | JSON-schema-constrained extraction with local models | Pick if self-hosting an LLM |
| Instructor | Pydantic-validated structured outputs over LLM APIs\[41\] | https://github.com/567-labs/instructor | MIT | 1.15.1 (~May 2026)\[42\] | Extract `{symptom, onset, duration, negated, severity}` objects with retries | **Primary pick** with an API LLM |
| pgvector | Vector search inside PostgreSQL | https://github.com/pgvector/pgvector | PostgreSQL License\[43\] | v0.8.6, Jul 2026\[44\] | RAG over encoded STW text and NLEM monographs; also settles Postgres vs MySQL | **Pick** (removes the need for Chroma) |
| Sarvam LLMs (e.g., Sarvam-M 24B) | Indic-tuned LLMs | Pricing page above | API/open weights (verify) | 2025–26 | Gujarati understanding / summarisation | Evaluate; Gujarati quality unverified |
| Llama / Qwen / Gemma | Open LLMs | Not verified in this pass | Varies (Llama community licence is not OSI) | — | Local LLM-only baseline | GPU needed for useful sizes; prefer an API |

**Judgement:** Use one API LLM with Instructor for extraction and a schema with explicit `negated` and `uncertain` flags. The hallucination metric is any extracted fact not grounded in a transcript span, so store character offsets.

## 3. Guided-Question Engine and Decision Support (M3)

| Resource | What it is | Link | Licence | Last activity | Use | Recommendation |
|---|---|---|---|---|---|---|
| ICMR Standard Treatment Workflows | One-page PDF workflows by specialty; mobile app | https://www.icmr.gov.in/standard-treatment-workflows-stws | Government publication (reuse terms not stated; cite and attribute) | App updated Jan 2026 | Source of truth for questions, red flags and first-line drugs | **Core source**\[45\]\[46\] |
| STW methodology paper (PMC) | Describes STW development; 122 conditions in 23 disciplines across Vols 1–3 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10472454/ | Open access | 2023 | Cite in the SRS for clinical validity | Cite |
| ICMR STW example (Cataract) | Shows format: symptoms, signs, ICD-10 code, levels of care | https://www.icmr.gov.in/icmrobject/uploads/STWs/1726569103_cataract.pdf | Gov | 2024 | Template for your JSON encoding | Reference\[19\] |
| MediQ | Interactive question-asking benchmark (Patient + Expert systems) | https://github.com/stellalisy/MediQ | See repo | 2024–25 | Borrow the abstain/ask/answer loop and the "number of questions" metric | **Reuse the evaluation design**\[47\]\[48\] |
| MediQ paper | Li et al. (University of Washington), NeurIPS 2024: "directly prompting state-of-the-art LLMs to ask questions degrades performance", while adding abstention improves diagnostic accuracy by 22.3% | https://arxiv.org/abs/2406.00922 | arXiv | 2024 | Justifies the hybrid design | Cite |
| json-rules-engine | JSON-defined rules for Node\[49\] | https://github.com/CacheControl/json-rules-engine | ISC | 7.3.2, Feb 2026\[50\] | Encode STW decision trees and safety rules as versioned JSON in the Node backend | **Primary pick** |
| Bahmni openmrs-module-cdss | FHIR-based CDSS integration: drug–diagnosis, drug–drug, dosage | https://github.com/Bahmni/openmrs-module-cdss | See repo | — | Design reference for CDS Hooks–style safety calls | Study |
| Durable Rules, CLIPS, Drools, DDXPlus, MedDialog, ReMeDi, Symptom2Disease, eSanjeevani CDSS (OLDCART), AMIE, IndicMedDialog | Alternatives / datasets | Not verified in this pass | — | — | Related work | Mark as unverified in the report |

**Design recommendation:** Represent each STW as a graph of nodes (question, answer type, SNOMED code), edges (conditions) and red-flag terminal nodes. The LLM only (a) maps utterances to answer slots and (b) phrases the next question in Gujarati. The rules choose *which* question to ask. Track top-1/top-3 accuracy and the number of questions asked, following the MediQ approach.

## 4. Medicine Database and Safety (M1, M4)

| Resource | What it is | Link | Licence | Last activity | Use | Recommendation |
|---|---|---|---|---|---|---|
| NLEM 2022 (CDSCO) | 384 medicines in 27 therapeutic categories; released 13 Sep 2022 | https://cdsco.gov.in/opencms/opencms/en/consumer/Essential-Medicines/ | Gov | 2022 | Seed the `medicine_master` table (generic, strength, dosage form, category) | **Core source**; manual PDF-to-CSV extraction\[51\]\[52\] |
| NLEM 2022 Committee report | Additions/deletions; 440 line items counting repeats | https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadPublic_NoticesFiles/reportnlem2022.pdf | Gov | 2022 | Rationale and category mapping | Reference (the report text says both "386" and "384"; use 384)\[53\] |
| NRCeS SNOMED CT + Common Drug Codes for India (CDCI) | National drug extension; India refsets; Hindi patient-instruction extension (490 concepts) | https://www.nrces.in/standards/snomed-ct and https://nrces.in/services/national-releases | Affiliate licence (free in India) | — | SNOMED codes for medicines, findings and dosing instructions | **Apply now**\[2\]\[54\]\[55\] |
| DDInter 2.0 | 302,516 DDIs, 2,310 drugs, therapeutic duplications, drug–disease interactions | https://ddinter2.scbdd.com | CC BY-NC-SA 4.0 | Published 2024 (NAR 2025) | Interaction + duplicate-class checks for NLEM drugs | **Pick for research**; non-commercial\[56\]\[57\]\[58\] |
| A-Z Medicine Dataset of India (Kaggle) | ~250K brands, composition, price (Nov 2022) | https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india | Unclear (scraped) | 2022 | Optional brand → generic mapping | Use cautiously; flag provenance\[59\] |
| Extensive A-Z Medicines Dataset | Merged brand/substitute/side-effect set | https://www.kaggle.com/datasets/riturajsingh2004/extensive-a-z-medicines-dataset-of-india | Labelled MIT (provenance still scraped) | — | Therapeutic/action class for duplicate-class rule | Optional |
| junioralive/Indian-Medicine-Dataset | JSON/CSV of Indian brands | https://github.com/junioralive/Indian-Medicine-Dataset | See repo | — | Brand autocomplete | Optional |
| RxNorm, WHO ATC/DDD, openFDA, DrugBank open, Jan Aushadhi list | Reference vocabularies | Not verified in this pass | Varies (WHO ATC has use restrictions; DrugBank open is CC BY-NC) | — | ATC class for the duplicate-class rule; DDD for dose sanity | Mark unverified |

**Max-dose / allergy data:** No open, licence-clean Indian dose-range dataset was found. Hand-curate max daily doses for the ~40–60 NLEM drugs used across your 5 conditions, sourced from the National Formulary of India or the product label, and store the source per row. Allergy cross-reactivity (e.g., penicillin–cephalosporin) should be a small hand-written rule table.

## 5. ABDM and FHIR (M6)

| Resource | What it is | Link | Licence | Last activity | Use | Recommendation |
|---|---|---|---|---|---|---|
| NRCeS FHIR IG for ABDM v6.5.0 | Profiles, value sets, examples | https://nrces.in/ndhm/fhir/r4/index.html | Gov | Generated 2025-05-08\[13\] | Conformance target | **Core** |
| OPConsultRecord profile | Composition profile for OP consult\[14\] | https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html | Gov | 6.5.0 | Bundle type for each visit | **Core** |
| Profiles index (PrescriptionRecord, MedicationRequest, Patient, Practitioner, Condition, Observation…) | — | https://www.nrces.in/ndhm/fhir/r4/profiles.html | Gov | 6.5.0 | Map ClinicOS tables to profiles | **Core** |
| NRCeS "Implementation Guide for Adoption of FHIR in ABDM and NHCX" | Pitfalls in bundle creation, validation steps, HAPI usage\[60\] | https://www.nrces.in/download/files/pdf/Implementation_Guide_for_Adoption_of_FHIR_in_ABDM_and_NHCX.pdf | Gov | — | Validation checklist for the SRS | Read first |
| HL7 FHIR validator (validator_cli) | Official validator jar | https://github.com/hapifhir/org.hl7.fhir.core | Apache-2.0 (unverified) | Frequent releases | CI: `-ig ndhm.in#6.5.0` validation of every generated bundle | **Pick** |
| HAPI FHIR JPA server starter | Dockerised FHIR server | https://github.com/hapifhir/hapi-fhir-jpaserver-starter | Apache-2.0 | Active | Optional test server | Optional |
| Medplum | TypeScript FHIR platform + React components\[61\] | https://github.com/medplum/medplum | Apache-2.0 | Very active | TS FHIR types for the Node bundle builder; UI ideas | Use the `@medplum/fhirtypes` idea; don't adopt the whole platform |
| fhir.resources (Python) | Pydantic FHIR models | https://github.com/nazrulworld/fhir.resources | BSD-3 (unverified) | Unverified | If the bundle builder lives in the Python service | Alternative |
| ABDM V3 Postman collection (Nirmitee) | M1/M2/M3 V3 endpoints, sandbox + prod envs\[62\] | https://github.com/Nirmitee-tech/abdm-v3-postman-collection | MIT | 2026 | Fastest way to exercise ABHA APIs | **Reuse** |
| ABDM sandbox docs mirror | V3 sequence diagrams, server URLs\[63\] | https://kiranma72.github.io/abdm-docs/2-milestone1/verify-abha-address/health-facility-qr-scan/index.html | Community mirror | — | Scan & Share flow | Reference (unofficial) |
| CoronaSafe ABDM implementer guide | Sandbox integration and exit process, M1/M2 end-state\[64\] | https://docs.coronasafe.network/abdm-documentation/implementers-guide/abdm-sandbox-integration-and-exit-process | Open docs | — | Requirements wording for M1 | Reference (older API versions) |
| Bahmni India Distro | ABDM-certified HIP/HIU: hip-service, openmrs-module-hip, ABHA-Verification, docker package | https://github.com/bahmniindiadistro | MIT (modules) | Jan–Feb 2025 | Study the HIP data model and care-context design | Study, don't fork (Java/C# stack)\[65\]\[66\] |
| Bahmni HIP architecture page | — | https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2901114904 | — | — | Architecture diagram reference | Study |
| Nirmitee guides (vendor blogs) | V3 step-by-step, HIP M2 callbacks\[67\]\[68\] | https://nirmitee.io/blog/step-by-step-guide-for-abdm-integration/ | Blog | 2026 | Practical gotchas | Useful but vendor content |

**Key ABDM V3 facts for the SRS (from practitioner sources; confirm on the official sandbox portal):**
- ABHA sandbox base: `https://abhasbx.abdm.gov.in/abha/api`. Gateway sandbox: `https://dev.abdm.gov.in/hiecm/api`. \[63\]\[69\]
- M1 endpoints: `/v3/enrollment/request/otp`, `/v3/profile/login/request/otp`, `/v3/profile/account/abha/search`.\[69\]
- M2 endpoints: link token via `/api/hiecm/v3/token/generate-token` (delivered on callback), then `/api/hiecm/hip/v3/link/carecontext`, one care context per call.\[70\]
- Aadhaar and OTP values are RSA-encrypted.\[70\]
- The ABHA card download fails with 406 if an `Accept` header is sent.\[68\]

## 6. WhatsApp and Gujarati Output (M7)

| Resource | What it is | Link | Licence | Use | Recommendation |
|---|---|---|---|---|---|
| WhatsApp message templates docs | Templates must be approved; Gujarati language code `gu` supported | https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/ | Meta terms | Gujarati "visit summary" utility template | **Core** |
| fbsamples/whatsapp-api-examples | Official Node samples (webhooks, templates, media) | https://github.com/fbsamples/whatsapp-api-examples | Meta Platform Policy | Copy webhook + template sender | **Reuse** |
| meta-cloud-api (TypeScript SDK) | Maintained SDK; Meta's own Node SDK archived since June 2023 | https://github.com/froggy1014/meta-cloud-api | See repo | Typed client in Node | Pick\[71\] |
| IndicTrans2 | En↔22 Indic translation; model checkpoints MIT | https://github.com/ai4bharat/IndicTrans2 | MIT (checkpoints), CC0/CC-BY-4.0 data | English summary → Gujarati (guj_Gujr) | Pick if not using Sarvam translate\[72\]\[73\] |
| Twilio, Gupshup, 360dialog | BSP alternatives | Not verified in this pass | Commercial | Fallback if Meta verification stalls | Alternative |

**Template design:** Keep the template generic, with variables (e.g., "નમસ્તે {{1}}, તમારી મુલાકાતનો સારાંશ: {{2}}"), and send the doctor-approved Gujarati text as a variable.\[74\]\[75\] Better still, send a PDF document link, because templates cannot carry free-form clinical text reliably. Never send before sign-off.

## 7. Frontend Building Blocks

| Resource | Use | Status |
|---|---|---|
| Medplum React components (https://github.com/medplum/medplum) | Study FHIR-aware forms and resource tables | Verified Apache-2.0\[76\] |
| OpenScribe note editor (https://github.com/sammargolis/OpenScribe) | Transcript → note editing UX | Verified MIT\[35\] |
| RecordRTC / react-media-recorder / wavesurfer.js / @react-pdf/renderer / shadcn-ui / TanStack Table | Recorder, waveform, PDF prescription, components | **Not verified in this pass.** The browser MediaRecorder + AudioWorklet → WebSocket (Socket.IO already in ClinicOS) is enough without extra libraries |

## 8. Evaluation Tooling

| Resource | Link | Licence | Use |
|---|---|---|---|
| jiwer | https://github.com/jitsi/jiwer (unverified) | Apache-2.0 (unverified) | WER/CER |
| Eka KARMA + medical ASR dataset | Links above | MIT dataset | Entity WER, semantic WER methodology\[28\] |
| MediQ | https://github.com/stellalisy/MediQ | — | Question-engine evaluation loop\[47\] |
| HL7 validator in CI | https://github.com/hapifhir/org.hl7.fhir.core | — | FHIR validity = % of bundles with 0 errors |
| "ASR Under the Stethoscope" (arXiv 2512.10967) | https://arxiv.org/pdf/2512.10967 | arXiv | Related work on clinical ASR bias across Indian languages\[34\] |
| Agricultural Indic ASR benchmark (arXiv 2602.03868) | https://arxiv.org/pdf/2602.03868 | arXiv | Shows diarization-aware "best speaker" WER methodology\[77\] |

---

## (a) Build vs Reuse Bill of Materials

| Architecture component | Decision | Concrete resource |
|---|---|---|
| Consultation UI (React 18 + Tailwind) | Build | ClinicOS shell; OpenScribe UX as reference |
| Audio capture + streaming | Build (thin) | MediaRecorder → Socket.IO → Python ASR service |
| VAD | Reuse | Silero VAD (MIT) |
| ASR (primary) | Reuse (API) | Sarvam Saaras V4, codemix mode + keyterms from NLEM |
| ASR (baseline) | Reuse | IndicConformer-600M (MIT) / IndicWhisper (Vistaar, MIT) |
| Diarization | Reuse | Sarvam ₹45/h tier (or pyannote) |
| Fact extraction | Build on reuse | API LLM + Instructor (MIT) + own JSON schema |
| Entity linking to SNOMED | Reuse | Parrotlet-e (CC-BY-SA-4.0) + NRCeS SNOMED CT release |
| Question engine (M3) | **Build** | ICMR STWs hand-encoded → json-rules-engine (ISC) |
| RAG over STWs | Reuse | pgvector in PostgreSQL 16 |
| Medicine master | Build on reuse | NLEM 2022 CSV + CDCI SNOMED codes + optional Kaggle brands |
| Safety checks (M4) | **Build** | Own rules + DDInter 2.0 (CC BY-NC-SA) + curated max-dose table |
| Sign-off + audit (M5) | Build | ClinicOS `audit_log`, append-only, hash-chained |
| FHIR bundle builder (M6) | Build on reuse | NRCeS IG 6.5.0 examples; Medplum fhirtypes or fhir.resources |
| FHIR validation | Reuse | HL7 validator_cli in GitHub Actions |
| ABHA verification | Reuse | ABDM V3 sandbox + Nirmitee Postman collection |
| Care-context linking (stretch) | Reuse/reference | Bahmni India hip-service design |
| WhatsApp summary (M7) | Reuse | WhatsApp Cloud API + fbsamples + IndicTrans2/Sarvam translate |
| ClinicOS link (M8) | Build | One REST endpoint + webhook |
| Evaluation | Reuse | jiwer, KARMA metrics, MediQ loop |
| Deployment | Reuse | Docker Compose: `web`, `api-node`, `asr-py` (FastAPI), `postgres+pgvector`; Redis optional |

## (b) Accounts, Credentials and Approvals — Apply This Week

1. **ABDM Sandbox client ID/secret** and HIP ID (M1, then M2). Unknown lead time; it is the biggest risk.
2. **NRCeS SNOMED CT Affiliate Licence** via MLDS (https://mlds.ihtsdotools.org/#/landing/IN). The download link arrives in 4–5 business days after acceptance.\[78\]
3. **Meta Business account + WhatsApp Cloud API** test number; submit the Gujarati utility template early.
4. **Sarvam API key** (₹100 free credit; top up about ₹2,500).
5. **Hugging Face account** (accept any gated-model terms for IndicConformer/pyannote).
6. **Bhashini/ULCA account** (optional backup).
7. **Institutional Ethics Committee / faculty approval** for recording acted consultations, plus written consent and an audio-release form from each actor.
8. **LLM API key** (with a "no training on data" setting).

## (c) Facts and Standards for SRS Non-Functional / Regulatory Sections

- **Intended use (CDSCO/MD/GD/MDSW/01/2026, 21 July 2026):** The guidance says intended use should state the medical purpose, the disease and its criticality, the patient population, users, use environment, contraindications, software function and platform.\[4\] The CDSCO matrix grades software that "informs clinical management" in a non-serious situation as Class A, and in a serious situation as Class B. Treatment or diagnosis software reaches Class C/D.\[6\] VaaniEHR must stay in the "inform" bucket, with mandatory clinician sign-off. The guidance also expects a lifecycle QMS (design, V&V, configuration, change, release, maintenance) and an **SBOM**, and introduces an optional Algorithm Change Protocol.\[3\]\[5\]\[79\] It is guidance under MDR 2017, not a new law.\[5\]\[6\]\[80\] Final PDF: https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/Guidance-document-on-Medical-Device-Software-under-MDR-2017.pdf
- **DPDP:** The Rules were notified 13 Nov 2025.\[7\] Rule 4 (Consent Managers) applies from 13 Nov 2026. Rules 3 and 5–16 (notice, consent, security safeguards, breach notification within 72 hours, data principal rights, retention) apply from 13 May 2027.\[81\]\[82\]\[83\] SRS requirements: an itemised notice, separate consent for audio recording and for AI processing, withdrawal, erasure, a breach runbook, and Gujarati notice text.
- **Interoperability:** FHIR R4 4.0.1; NRCeS IG ndhm.in 6.5.0;\[16\]\[60\] SNOMED CT (NRCeS affiliate licence; end users need a sublicence);\[2\] ABHA number (14-digit) and ABHA address stored per patient.\[67\]
- **Security:** Treat the OWASP Top 10 for LLM Applications as a requirement source. The 2025 list is LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Supply Chain, LLM04 Data and Model Poisoning, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses, LLM09 Misinformation, LLM10 Unbounded Consumption.\[84\] OWASP's GitHub states that the "OWASP GenAI LLM Top 10 2026" was published on 4 August 2026. That edition re-orders these items and renames System Prompt Leakage as "Hidden Context Exposure"; cite the 2026 list as current. OWASP ASVS Level 2 for the web app (unverified version). JWT + RBAC, TLS, encryption at rest for audio.
- **Lifecycle standards:** ISO/IEC/IEEE 29148:2018 (SRS structure), IEC 62304 (software lifecycle, safety class), IEC 82304-1 (health software) and WCAG 2.1 AA. None was re-verified in this pass; cite them by name.
- **NMC generic-prescribing rule status:** not verified in this pass. State "generic-first by design" without asserting the current legal status.

## (d) Pitfalls

- **Non-commercial data:** DDInter, possibly WHO ATC, and DrugBank open are non-commercial.\[1\] If ClinicOS is ever commercialised, M4 needs a replacement source.
- **Gated or "MIT" models:** Verify access and licence at download time. One paper calls IndicConformer gated even though the model card says MIT.\[22\]\[23\]
- **Sandbox instability:** Some V3 HIP-initiated endpoints return 403 in community tests.\[62\] Do not put M2 on the critical path.
- **Postgres vs MySQL:** pgvector and JSONB argue for **PostgreSQL 16**. Settle this before writing migrations.
- **Prices and versions:** Saaras V4 is new (Sept 2026) and API-only,\[21\] so pin the model version used in evaluation.
- **Acted data ≠ real data:** Report this as a limitation. Use several Gujarati speakers and accents, plus background noise.
- **LLM-generated Gujarati summaries** must be doctor-approved text only. Log the exact message sent.

---

# PRD — VaaniEHR (shareable with developers / AI builders)

## 1. Overview and Goals
**Product:** VaaniEHR, a web module that listens to a general-medicine OPD consultation in Gujarati/Hindi/English, asks guideline-based follow-up questions, suggests safety-checked NLEM medicines, and produces a doctor-signed, ABDM-ready FHIR record plus a Gujarati WhatsApp summary.
**Positioning:** A research prototype using acted/simulated data only. It is not for clinical use.
**Goals:**
- (G1) Cut documentation time per visit.
- (G2) Have zero unsafe suggestions reach sign-off undetected.
- (G3) Make 100% of signed visits produce a valid NRCeS FHIR bundle.
- (G4) Publish a Gujarati acted-consultation benchmark.

## 2. Target Audience
- **Primary:** General-practice doctors in Gujarat-region OPDs (adult patients). They are bilingual or trilingual, time-poor and use a phone or laptop.
- **Secondary:** Clinic staff (registration, ABHA capture), patients (receive the Gujarati summary), and the clinic admin (templates, audit).
- **Research users:** Faculty and evaluators running the benchmarks.

## 3. Required Pages
1. Login (ClinicOS JWT)
2. Doctor dashboard (today's tokens, drafts awaiting sign-off)
3. Patient lookup/registration, with ABHA verify (sandbox)
4. Consent capture (recording + AI processing, Gujarati/English, withdraw)
5. **Consultation workspace:** live transcript, extracted facts, guided-question panel, red-flag banner
6. Diagnosis review (top-3 with STW citations)
7. **Prescription builder:** generic-first NLEM autocomplete, brand optional, templates, inline safety alerts
8. Review and sign-off (diff of AI vs doctor edits; sign = commit)
9. Visit record / FHIR viewer (bundle JSON + validation result)
10. Patient summary preview and WhatsApp send log
11. Medicine master and prescription-template admin
12. Rules/STW library admin (versioned decision trees)
13. Audit log viewer
14. Evaluation console (upload acted audio, run baselines, metrics dashboard)
15. Settings (API keys, language, intended-use statement / About page)

## 4. Core Features and Priority
| ID | Feature | Priority |
|---|---|---|
| F1 | Consent gate before any recording | P0 |
| F2 | Streaming code-switched ASR with transcript editing | P0 |
| F3 | Fact extraction with negation and source-span links | P0 |
| F4 | STW-based guided questions (5 conditions), red-flag stop | P0 |
| F5 | NLEM medicine DB with SNOMED codes, generic-first | P0 |
| F6 | Safety checks: allergy, max dose, duplicate class, DDI, red flag | P0 |
| F7 | Doctor sign-off; nothing persisted as final before sign-off; audit log | P0 |
| F8 | FHIR OPConsultRecord/Prescription bundle + validator | P0 |
| F9 | ABHA verification (sandbox, M1) | P1 |
| F10 | Gujarati WhatsApp summary after sign-off | P1 |
| F11 | Prescription templates | P1 |
| F12 | Evaluation console and baselines | P1 |
| F13 | ClinicOS single-API integration | P1 |
| F14 | HIP care-context linking (M2) | P2 |
| F15 | Prescription PDF | P2 |

## 5. User Journeys
- **Doctor consultation (happy path):** Pick a token → confirm consent → press Record → speak naturally → transcript and facts appear → the question panel suggests "Any blood in sputum?" (from the STW) → the doctor asks it, and the answer is captured → top-3 diagnoses with citations appear → the doctor selects one → suggested NLEM drugs appear with green/amber/red checks → the doctor edits the doses → reviews the diff → signs → FHIR bundle validated → Gujarati summary sent.
- **Red-flag path:** A red flag is detected (e.g., chest pain + sweating) → a blocking banner shows "refer/urgent" → medicine suggestions are suppressed → the doctor acknowledges, and the acknowledgement is logged.
- **Staff registration:** Phone lookup → new patient → ABHA verify via OTP (sandbox) → ABHA number/address saved → token issued.
- **Patient:** Receives the WhatsApp template in Gujarati with the summary and medicine schedule.
- **Researcher:** Uploads acted audio + gold annotations → runs rules-only / LLM-only / hybrid → views metrics.

## 6. Success Metrics (targets for the acted benchmark; set as hypotheses)
- ASR: WER/CER on Gujarati code-switched speech, reported against the Vistaar Gujarati baselines (17.8–33.2% general domain); medicine-name accuracy ≥90% with keyterm biasing.
- Extraction: precision/recall ≥0.85, including negated findings; hallucination rate (ungrounded facts) ≤2%.
- Question engine: top-3 accuracy ≥85%, top-1 ≥65%; median questions ≤6. The hybrid should beat rules-only and LLM-only.
- Safety: 100% of seeded unsafe scenarios flagged; 0 unsafe items signed without an override reason.
- FHIR: 100% of signed visits validate with 0 errors against ndhm.in 6.5.0.
- Workflow: documentation time per visit lower than a manual-typing baseline; SUS score from the doctors who test it.

---

## Caveats
- I could not open some sources directly, and verified some repos only through search snippets. Unverified items are marked in the tables: jiwer, fhir.resources and HL7 validator licences; RecordRTC and other UI libraries; Bhashini; RxNorm/ATC/openFDA; dialogue datasets; IEEE/IEC/WCAG texts; NMC rules.
- ABDM V3 endpoint details come from practitioner and vendor sources (Nirmitee, community docs), not the official portal. Confirm them after you get sandbox access.
- The metric targets above are proposed hypotheses, not published benchmarks.

## Sources

1. [Bioregistry - Curated Drug-Drug Interactions Database - Drug](https://bioregistry.io/ddinter.drug)
2. [FAQs](https://www.nrces.in/faqs)
3. [CDSCO releases final guidance document on medical device software - Lexology](https://www.lexology.com/library/detail.aspx?g=0049fff8-5f9c-469c-8701-0a30b009a4c5)
4. [CDSCO Releases Guidance on Medical Device Software Regulations](https://natlawreview.com/article/code-compliance-decoding-indias-medical-device-software-guidance)
5. [CDSCO Medical Device Software Guidance 2026: MDSW Classes, Portals & Change Protocols](https://meddeviceguide.com/blog/india-cdsco-medical-device-software-mdsw-guidance-2026-guide)
6. [India Finalizes Medical Device Software Guidance](https://asiaactual.com/blog/india-medical-device-software-guidance/)
7. [DPDP Act Timeline: When Compliance Is Mandatory](https://ispectratechnologies.com/hub/dpdp/dpdp-timeline.html)
8. [GitHub - AI4Bharat/vistaar: Vistaar: Diverse Benchmarks and Training Sets for Indian Language ASR](https://github.com/AI4Bharat/vistaar)
9. [KARMA-OpenMedEvalKit: Evaluating Medical AI for India](https://www.eka.care/services/introducing-karma-openmedevalkit-an-open-source-framework-for-medical-ai-evaluation)
10. [Medical Scribe - Eka Developer Platform APIs](https://developer.eka.care/eka-medai/technologies/medical-scribe)
11. [Sarvam AI Speech-to-Text cost: ₹30/hour base rate - Smallest.ai](https://smallest.ai/blog/sarvam-ai-speech-to-text-pricing)
12. [Sarvam AI Pricing - Transparent Rates for Indian Language AI APIs](https://docs.sarvam.ai/api/getting-started/pricing)
13. [OPConsultRecord - FHIR Implementation Guide for ABDM v6.5.0](https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html)
14. [Profiles - FHIR Implementation Guide for ABDM v6.5.0](https://www.nrces.in/ndhm/fhir/r4/profiles.html)
15. [Home - FHIR Implementation Guide for ABDM v6.5.0](https://nrces.in/ndhm/fhir/r4/index.html)
16. [ABDM FHIR Bundles Guide: NRCeS Profiles and 8 HI Types](https://nirmitee.io/blog/understanding-abdm-fhir-bundles-complete-guide-zero-to-expert/)
17. [Patient - FHIR Implementation Guide for ABDM v6.5.0](https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-Patient.html)
18. [Standard Treatment Workflows](https://play.google.com/store/apps/details?id=com.icmr.stw&hl=en_IN)
19. [ICMR Standard Treatment Workflow (STW) CATARACT](https://www.icmr.gov.in/icmrobject/uploads/STWs/1726569103_cataract.pdf)
20. [Saaras V4 API — Speech-to-Text by Sarvam AI](https://www.callmissed.com/models/saaras-v4)
21. [Sarvam AI Releases Saaras V4: A Speech-to-Text Model for All 22 Indian Languages and Global English - MarkTechPost](https://www.marktechpost.com/2026/09/26/sarvam-ai-releases-saaras-v4-a-speech-to-text-model-for-all-22-indian-languages-and-global-english/)
22. [ai4bharat/indic-conformer-600m-multilingual · Hugging Face](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual)
23. [The TTS-STT Flywheel: Synthetic Entity-Dense Audio Closes the Indic ASR Gap Where Commercial and Open-Source Systems Fail](https://arxiv.org/pdf/2605.03073)
24. [GitHub - AI4Bharat/IndicConformerASR · GitHub](https://github.com/AI4Bharat/IndicConformerASR)
25. [atharva-again/indic-conformer-600m-quantized · Hugging Face](https://huggingface.co/atharva-again/indic-conformer-600m-quantized)
26. [Indian Healthcare AI Evaluation Datasets by EkaCare](https://www.eka.care/services/advancing-healthcare-ai-evaluation-in-india-ekacare-releases-four-evaluation-datasets)
27. [EkaCare Medical Public Datasets - a ekacare Collection](https://huggingface.co/collections/ekacare/ekacare-medical-public-datasets)
28. [Eka.care Launches KARMA to Evaluate & Benchmark Clinical AI in India](https://www.digitalhealthnews.com/eka-care-launches-karma-to-evaluate-benchmark-clinical-ai-in-india)
29. [ekacare/parrotlet-e · Hugging Face](https://huggingface.co/ekacare/parrotlet-e)
30. [GitHub - SYSTRAN/faster-whisper at v1.1.0 · GitHub](https://github.com/SYSTRAN/faster-whisper/tree/v1.1.0)
31. [Releases · SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper/releases)
32. [ggml-org/whisper.cpp on GitHub](https://releasealert.dev/github/ggml-org/whisper.cpp)
33. [Releases · pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio/releases)
34. [ASR Under the Stethoscope: Evaluating Biases in Clinical Speech Recognition across Indian Languages](https://arxiv.org/pdf/2512.10967)
35. [GitHub - sammargolis/OpenScribe: OpenScribe is an open-source AI scribe that records patient encounters and generates structured clinical notes automatically. You keep full control over data, workflows, and patient privacy with no vendor lock-in. · GitHub](https://github.com/sammargolis/OpenScribe)
36. [GitHub - ishandutta2007/Awesome-Medical-Scribe-AI: Top Medical Scribe AI 🌟 Star if you like it! 🌟](https://github.com/ishandutta2007/Awesome-Medical-Scribe-AI)
37. [GitHub - medspacy/medspacy: Library for clinical NLP with spaCy. · GitHub](https://github.com/medspacy/medspacy)
38. [medspacy · PyPI](https://pypi.org/project/medspacy/)
39. [medspacy · GitHub](https://github.com/medspacy)
40. [dottxt-ai/outlines: Strict LLM Structured Output Framework - HelloGitHub](https://hellogithub.com/en/repository/67612bf932a04a8c9bef1741c867069b)
41. [567-labs/instructor: Python Library for Structuring LLM Outputs - HelloGitHub](https://hellogithub.com/en/repository/567-labs/instructor)
42. [https://github.com/567-labs/instructor summary](https://summary.ecosyste.ms/projects/369913)
43. [pgvector: What It's Used For, Limits, and When to Use It \[2026\]](https://atlan.com/know/ai-agent/data-for-ai/what-is-pgvector/)
44. [pgvector/pgvector on GitHub](https://releasealert.dev/github/pgvector/pgvector)
45. [Standard Treatment Workflows (STWs)](https://www.icmr.gov.in/standard-treatment-workflows-stws)
46. [Standard Treatment Workflows on the App Store](https://apps.apple.com/in/app/standard-treatment-workflows/id6547853423)
47. [GitHub - stellalisy/mediQ · GitHub](https://github.com/stellalisy/MediQ)
48. [ALFA: Aligning LLMs to Ask Good Questions A Case Study in Clinical Reasoning](https://arxiv.org/pdf/2502.14860)
49. [json-rules-engine - npm](https://www.npmjs.com/package/json-rules-engine?activeTab=versions)
50. [R&D: json-rules-engine for data-driven studio events and opportunity conditions · Issue #36 · sp80808/recording-studio-tycoon](https://github.com/sp80808/recording-studio-tycoon/issues/36)
51. [Union Health Ministry releases NLEM 2022, 34 drugs added, 26 removed](https://medicaldialogues.in/news/industry/pharma/union-health-ministry-releases-nlem-2022-34-drugs-added-26-removed-99083)
52. [List of Essential Medicines](https://cdsco.gov.in/opencms/opencms/en/consumer/Essential-Medicines/)
53. [Report](https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadPublic_NoticesFiles/reportnlem2022.pdf)
54. [Common Drug Codes for India (CDCI)](https://nrces.in/services/national-releases)
55. [India Patient Instructions Language Extension for ...](https://www.nrces.in/download/files/pdf/doc_SnomedCT-IndiaPatientInstructionsLanguageExtension-ReleaseNotes_Current-en-US_IN1000189_20210806.pdf)
56. [GitHub - mnarayan1/DDInter · GitHub](https://github.com/mnarayan1/DDInter)
57. [(PDF) DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface](https://www.researchgate.net/publication/383396908_DDInter_20_an_enhanced_drug_interaction_resource_with_expanded_data_coverage_new_interaction_types_and_improved_user_interface)
58. [DDInter - Database Commons](https://ngdc.cncb.ac.cn/databasecommons/database/id/7473)
59. [A-Z Medicine Dataset of India](https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india)
60. [Implementation Guide for Adoption of FHIR in ABDM and ...](https://www.nrces.in/download/files/pdf/Implementation_Guide_for_Adoption_of_FHIR_in_ABDM_and_NHCX.pdf)
61. [GitHub - api-evangelist/medplum: Medplum is an Apache 2.0 open-source, FHIR-native developer platform for shipping clinical software. It bundles a FHIR R4 datastore, REST and GraphQL APIs, a TypeScript SDK, React component library, OAuth 2.0 / SMART on FHIR authentication, declarative Access Policies, Subscriptions, and TypeScript-based serverless Bots — sold as a hosted service…](https://github.com/api-evangelist/medplum)
62. [GitHub - Nirmitee-tech/abdm-v3-postman-collection: Complete Postman collection for ABDM V3 APIs — all endpoints, sandbox + production environments](https://github.com/Nirmitee-tech/abdm-v3-postman-collection)
63. [Scan Health Facility QR - ABDM Sandbox Documentation](https://kiranma72.github.io/abdm-docs/2-milestone1/verify-abha-address/health-facility-qr-scan/index.html)
64. [ABDM Sandbox Integration and Exit process](https://docs.coronasafe.network/abdm-documentation/implementers-guide/abdm-sandbox-integration-and-exit-process)
65. [BahmniIndiaDistro · GitHub](https://github.com/bahmniindiadistro)
66. [Bahmni as Health Information Provider (ABDM/NDHM) - Bahmni Wiki - Confluence](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2901114904)
67. [Build an ABDM HIP (M2): V3 Reference Architecture Guide](https://nirmitee.io/blog/building-abdm-hip-from-scratch-m2-flow-reference-architecture/)
68. [ABDM Integration Guide: Step by Step, Sandbox to Go-Live](https://nirmitee.io/blog/step-by-step-guide-for-abdm-integration/)
69. [ABDM ABHA V3 API — Complete Reference Guide](https://devlprnitish.medium.com/abdm-abha-v3-api-complete-reference-guide-761d91cefb94)
70. [ABDM Milestones M1, M2, M3 and M4 Explained (2026 Guide)](https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/)
71. [GitHub - ismailvc1111/meta-cloud-api: The actively maintained TypeScript SDK for the official WhatsApp Cloud API — the alternative to Meta's archived Node.js SDK.](https://github.com/ismailvc1111/meta-cloud-api)
72. [GitHub - AI4Bharat/IndicTrans2: Translation models for 22 scheduled languages of India · GitHub](https://github.com/ai4bharat/IndicTrans2)
73. [IndicTrans2: Towards High-Quality and Accessible ...](https://arxiv.org/pdf/2305.16307)
74. [.template](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/)
75. [WhatsApp API Message Templates: Complete Guide \[2026\]](https://gurusup.com/blog/whatsapp-api-message-templates)
76. [GitHub - medplum/medplum: Medplum is a healthcare platform that helps you quickly develop high-quality compliant applications. · GitHub](https://github.com/medplum/medplum)
77. [Benchmarking Automatic Speech Recognition for Indian Languages in Agricultural Contexts](https://arxiv.org/pdf/2602.03868)
78. [SNOMED CT](https://www.nrces.in/standards/snomed-ct)
79. [Medical Device As Software: Has CDSCO Guidance Changed The Rules?](https://corporate.cyrilamarchandblogs.com/2026/01/medical-device-as-software-has-cdsco-guidance-changed-the-rules/)
80. [Medical Device As Software: Has CDSCO Guidance Changed The Rules? - Lexology](https://www.lexology.com/library/detail.aspx?g=79f45643-4003-411a-85d7-7ea945a8c974)
81. [DPDP Compliance Guide 2026: Requirements & Deadlines](https://www.privybyidfy.com/blog/dpdp-compliance-guide-2026-what-indian-enterprises-must-do-before-may-2027)
82. [DPDP Act Deadline 2027: Month-by-Month Compliance Calendar](https://www.consently.in/blog/dpdp-act-deadline-2027-compliance-calendar)
83. [DPDP Rules 2025: Complete Compliance Guide](https://www.privacyglobal.org/blog/dpdp-rules-need-to-know)
84. [Top 10 for LLM and GenAI - OWASP Gen AI Security Project](https://genai.owasp.org/initiatives/top-10-for-llm-and-genai/)
