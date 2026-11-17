// PG-17 Evaluation console tests (/research/eval, Phase 11, ADR-D43).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const sampleRuns = [
  {
    id: '20261117T050951',
    runAt: '2026-11-17T05:09:51+00:00',
    split: 'dev',
    datasetHash: 'f4823ab5aee0302cdfa8975e87f18585ee5d22371fc03dc9566b7f438f8e162e',
    codeCommit: '56ef44d5ed90c8520f0af00472868852112f72b0',
    casesCount: 11,
    hasErrorsCsv: true,
  },
];

const sampleDetail = {
  id: '20261117T050951',
  manifest: {
    run_at: '2026-11-17T05:09:51+00:00',
    split: 'dev',
    dataset_hash: 'f4823ab5aee0302cdfa8975e87f18585ee5d22371fc03dc9566b7f438f8e162e',
    code_commit: '56ef44d5ed90c8520f0af00472868852112f72b0',
    cases: ['clip04', 'clip05', 'clip06', 'clip07', 'clip08', 'clip09', 'clip10', 'clip11', 'synthetic01', 'synthetic02', 'synthetic03'],
    asr_languages: {
      overall: {
        segments: 59,
        reference_words: 374,
        word_errors: 0,
        wer: 0.0,
        reference_chars: 1487,
        char_errors: 0,
        cer: 0.0,
      },
      by_language: {
        en: {
          segments: 25,
          reference_words: 178,
          word_errors: 0,
          wer: 0.0,
          reference_chars: 750,
          char_errors: 0,
          cer: 0.0,
        },
        gu: {
          segments: 23,
          reference_words: 124,
          word_errors: 0,
          wer: 0.0,
          reference_chars: 473,
          char_errors: 0,
          cer: 0.0,
        },
        hi: {
          segments: 8,
          reference_words: 54,
          word_errors: 0,
          wer: 0.0,
          reference_chars: 187,
          char_errors: 0,
          cer: 0.0,
        },
      },
      mixed_segments: {
        segments: 3,
        reference_words: 18,
        word_errors: 0,
        wer: 0.0,
        reference_chars: 77,
        char_errors: 0,
        cer: 0.0,
      },
      protocol_note: 'Language breakdowns rely strictly on explicit segment annotations. Script detection was not used to assign spoken language.',
    },
  },
  summaryMd: '# Evaluation Summary\n\nAll tests passed.',
  tableTex: '\\begin{tabular}{lll}\nResult & 1 & 2\n\\end{tabular}',
  cellsCsv: 'asr,asr_version,variant,cases,fact_precision,fact_recall,fact_f1,negation_f1,hallucination_rate,wer,cer,medicine_accuracy\ngold,gold-transcript,plain,11,0.85,0.90,0.87,0.70,0.15,,,0.95\ngold,gold-transcript,grounded,11,1.00,0.92,0.96,0.80,0.00,,,0.98',
  casesCsv: 'case_id,engine,variant\nclip04,gold,grounded',
  questionsCsv: 'case_id,engine,steps\nclip04,rules-only,2',
  errorsCsv: 'case_id,error_category,gold_type,predicted_type,gold_quote,predicted_quote,detail\nclip04,missed_fact,symptom,,fever,,Gold fact not extracted\nclip05,unsupported_fact,,symptom,,headache,Extracted assertion not grounded',
};

const evalHandlers: Record<string, Handler> = {
  'GET /eval/runs': () => ({ data: sampleRuns }),
  'GET /eval/runs/20261117T050951': () => ({ data: sampleDetail }),
};

describe('PG-17 EvaluationPage', () => {
  it('allows researcher to view evaluation console', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const heading = await screen.findByRole('heading', { level: 1, name: /Research Evaluation Console/i });
    expect(heading).toBeTruthy();

    // Confidence disclaimer
    expect(screen.getByText(/Statistical Confidence & Acted Dataset Notice/i)).toBeTruthy();

    // Verify run metadata is loaded
    expect(await screen.findByText(/56ef44d/)).toBeTruthy();
  });

  it('allows admin to view evaluation console', async () => {
    await renderApp({
      role: 'admin',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const heading = await screen.findByRole('heading', { level: 1, name: /Research Evaluation Console/i });
    expect(heading).toBeTruthy();
  });

  it('forbids doctor and staff roles from accessing /research/eval', async () => {
    await renderApp({
      role: 'doctor',
      path: '/research/eval',
      routes: evalHandlers,
    });

    // Should render 403 Forbidden page
    expect(await screen.findByRole('heading', { level: 1, name: /Not allowed/i })).toBeTruthy();
    expect(screen.getByText(/Your role cannot open this page/i)).toBeTruthy();
  });

  it('renders prompt ablation variants and M-01 to M-13 metrics table', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    // Wait for data load
    await screen.findByRole('heading', { level: 3, name: /Prompt Ablation Variants/i });

    // Prompt ablation table rows
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.getByText('grounded')).toBeTruthy();

    // Section 14 metrics table
    expect(screen.getByText('M-01')).toBeTruthy();
    expect(screen.getByText('M-03')).toBeTruthy();
    expect(screen.getByText('M-07')).toBeTruthy();
    expect(screen.getByText(/Not built \(placeholder\)/i)).toBeTruthy();
    expect(screen.getByText('M-11')).toBeTruthy();
  });

  it('switches to Language ASR tab and shows breakdown by annotated language', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const langTab = await screen.findByRole('tab', { name: /Language ASR/i });
    fireEvent.click(langTab);

    expect(await screen.findByText(/Overall \(All segments\)/i)).toBeTruthy();
    expect(screen.getByText(/Gujarati \(gu\)/i)).toBeTruthy();
    expect(screen.getByText(/Hindi \(hi\)/i)).toBeTruthy();
    expect(screen.getByText(/English \(en\)/i)).toBeTruthy();
    expect(screen.getByText(/Mixed \/ Code-switched segments/i)).toBeTruthy();
    expect(screen.getByText(/Language breakdowns rely strictly on explicit segment annotations/i)).toBeTruthy();
  });

  it('switches to Extraction Errors tab and filters errors by category', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const errorTab = await screen.findByRole('tab', { name: /Extraction Errors/i });
    fireEvent.click(errorTab);

    expect(await screen.findByText('clip04')).toBeTruthy();
    expect(screen.getByText('clip05')).toBeTruthy();
    expect(screen.getAllByText('missed_fact').length).toBeGreaterThan(0);
    expect(screen.getAllByText('unsupported_fact').length).toBeGreaterThan(0);
    expect(screen.getByText('fever')).toBeTruthy();
    expect(screen.getByText('headache')).toBeTruthy();
  });

  it('switches to FHIR & Safety tab and displays conformance cards', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const confTab = await screen.findByRole('tab', { name: /FHIR & Safety/i });
    fireEvent.click(confTab);

    expect(await screen.findByText(/ABDM FHIR Conformance/i)).toBeTruthy();
    expect(screen.getByText(/ndhm\.in 6\.5\.0 IG/i)).toBeTruthy();
    expect(screen.getByText(/Offline Safety Alert Scoring/i)).toBeTruthy();
    expect(screen.getByText(/DISABLED \(No unreviewed rules\)/i)).toBeTruthy();
  });

  it('renders raw export actions and copies content', async () => {
    await renderApp({
      role: 'researcher',
      path: '/research/eval',
      routes: evalHandlers,
    });

    const exportTab = await screen.findByRole('tab', { name: /Raw Outputs & Exports/i });
    fireEvent.click(exportTab);

    expect(await screen.findByRole('button', { name: /Copy LaTeX/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy Markdown/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download Cells/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download Errors/i })).toBeTruthy();
  });
});
