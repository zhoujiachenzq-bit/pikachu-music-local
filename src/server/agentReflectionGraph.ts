import { createHash, randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { Db } from './db.js';

export type MusicIntentKind = 'play_song' | 'play_artist' | 'recommend' | 'chat' | 'ambiguous';
export type ReflectionVerdict = 'pass' | 'revise' | 'ask_user' | 'skipped' | 'failed';

export interface MusicIntentProposal {
  intent: MusicIntentKind;
  subject?: string;
  artist?: string;
  confidence: number;
  reasonCodes: string[];
}

export interface MusicIntentEvidence {
  exactArtist: boolean;
  exactTitle: boolean;
  artistTrackCount: number;
  titleTrackCount: number;
  explicitArtistSyntax: boolean;
}

export interface ShadowModelResult extends MusicIntentProposal {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface MusicIntentShadowResult {
  subject: string;
  legacyIntent: MusicIntentKind;
  proposedIntent: MusicIntentKind;
  finalIntent: MusicIntentKind;
  verdict: ReflectionVerdict;
  confidence: number;
  reasonCodes: string[];
  evidence: MusicIntentEvidence;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface PlaySubject {
  candidate: string;
  explicitArtist: boolean;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\-—_()（）【】\[\]'.·,，:：]/g, '');
}

function extractPlaySubject(message: string): PlaySubject | null {
  const value = message.trim().replace(/[。！!]+$/g, '').trim();
  if (/[《「“"》」”]/u.test(value)) return null;
  const explicit = value.match(/^(?:请|麻烦)?(?:帮我)?(?:播放(?:一首|首)?|放(?:一首|首)?|来(?:一首|首)?|想听|听听?)\s*(.+?)(?:的(?:歌|歌曲|音乐)|唱的(?:歌|歌曲)?)$/u);
  if (explicit?.[1].trim()) return { candidate: explicit[1].trim(), explicitArtist: true };
  const shorthand = value.match(/^(?:请|麻烦)?(?:帮我)?(?:播放(?:一首|首)?|放(?:一首|首)?|来(?:一首|首)?)\s*(.+)$/u);
  return shorthand?.[1].trim() ? { candidate: shorthand[1].trim(), explicitArtist: false } : null;
}

function exactEvidence(db: Db, subject: PlaySubject): MusicIntentEvidence {
  const key = normalize(subject.candidate);
  const artists = db.prepare("SELECT artist value FROM tracks WHERE artist<>'' UNION ALL SELECT artist value FROM knowledge_documents WHERE artist<>''").all() as Array<{ value: string }>;
  const titles = db.prepare("SELECT title value FROM tracks WHERE title<>'' UNION ALL SELECT title value FROM knowledge_documents WHERE title<>''").all() as Array<{ value: string }>;
  const artistTrackCount = artists.filter(row => normalize(row.value) === key).length;
  const titleTrackCount = titles.filter(row => normalize(row.value) === key).length;
  return { exactArtist: artistTrackCount > 0, exactTitle: titleTrackCount > 0, artistTrackCount, titleTrackCount, explicitArtistSyntax: subject.explicitArtist };
}

export function shouldRunMusicIntentShadow(message: string) {
  return Boolean(extractPlaySubject(message));
}

export function expectedIntentFromEvidence(evidence: MusicIntentEvidence): MusicIntentKind {
  if (evidence.explicitArtistSyntax) return 'play_artist';
  if (evidence.exactArtist && !evidence.exactTitle) return 'play_artist';
  if (evidence.exactTitle && !evidence.exactArtist) return 'play_song';
  return 'ambiguous';
}

const ShadowState = Annotation.Root({
  message: Annotation<string>(),
  legacyIntent: Annotation<MusicIntentKind>(),
  subject: Annotation<string>(),
  explicitArtist: Annotation<boolean>(),
  evidence: Annotation<MusicIntentEvidence>(),
  proposal: Annotation<ShadowModelResult | null>(),
  proposedIntent: Annotation<MusicIntentKind>(),
  finalIntent: Annotation<MusicIntentKind>(),
  verdict: Annotation<ReflectionVerdict>(),
  confidence: Annotation<number>(),
  reasonCodes: Annotation<string[]>(),
  provider: Annotation<string>(),
  model: Annotation<string>(),
  inputTokens: Annotation<number>(),
  outputTokens: Annotation<number>()
});

export function createMusicIntentShadowGraph(db: Db, analyze: (message: string, subject: string, evidence: MusicIntentEvidence) => Promise<ShadowModelResult | null>) {
  const graph = new StateGraph(ShadowState)
    .addNode('local_parse', state => {
      const subject = extractPlaySubject(state.message);
      return subject ? { subject: subject.candidate, explicitArtist: subject.explicitArtist } : { verdict: 'skipped' as const, reasonCodes: ['NOT_A_PLAY_SUBJECT'] };
    })
    .addNode('gather_evidence', state => {
      if (!state.subject) return {};
      return { evidence: exactEvidence(db, { candidate: state.subject, explicitArtist: state.explicitArtist }) };
    })
    .addNode('semantic_parse', async state => {
      if (!state.subject) return {};
      const proposal = await analyze(state.message, state.subject, state.evidence).catch(() => null);
      if (!proposal) return { proposedIntent: state.legacyIntent, reasonCodes: ['MODEL_PARSE_UNAVAILABLE'] };
      return {
        proposal,
        proposedIntent: proposal.intent,
        confidence: Math.max(0, Math.min(1, proposal.confidence)),
        reasonCodes: proposal.reasonCodes.slice(0, 8),
        provider: proposal.provider,
        model: proposal.model,
        inputTokens: proposal.inputTokens,
        outputTokens: proposal.outputTokens
      };
    })
    .addNode('critic', state => {
      if (!state.subject) return { finalIntent: state.legacyIntent, verdict: 'skipped' as const };
      const expected = expectedIntentFromEvidence(state.evidence);
      const reasons = [...state.reasonCodes];
      if (!state.proposal && expected !== 'ambiguous') {
        reasons.push('REFLECTION_MODEL_UNAVAILABLE');
        return { finalIntent: expected, verdict: 'skipped' as const, confidence: .8, reasonCodes: [...new Set(reasons)] };
      }
      if (expected === 'ambiguous') {
        reasons.push(state.evidence.exactArtist && state.evidence.exactTitle ? 'ARTIST_TITLE_COLLISION' : 'INSUFFICIENT_IDENTITY_EVIDENCE');
        return { finalIntent: expected, verdict: 'ask_user' as const, confidence: Math.min(state.confidence, .49), reasonCodes: [...new Set(reasons)] };
      }
      if (state.proposedIntent !== expected) {
        reasons.push(expected === 'play_artist' ? 'EXACT_ARTIST_EVIDENCE_OVERRULED_MODEL' : 'EXACT_TITLE_EVIDENCE_OVERRULED_MODEL');
        return { finalIntent: expected, verdict: 'revise' as const, confidence: .98, reasonCodes: [...new Set(reasons)] };
      }
      reasons.push('MODEL_MATCHES_IDENTITY_EVIDENCE');
      return { finalIntent: expected, verdict: 'pass' as const, confidence: Math.max(.85, state.confidence), reasonCodes: [...new Set(reasons)] };
    })
    .addEdge(START, 'local_parse')
    .addEdge('local_parse', 'gather_evidence')
    .addEdge('gather_evidence', 'semantic_parse')
    .addEdge('semantic_parse', 'critic')
    .addEdge('critic', END)
    .compile();

  return graph;
}

export async function runMusicIntentShadowGraph(
  db: Db,
  input: { message: string; legacyIntent: MusicIntentKind },
  analyze: (message: string, subject: string, evidence: MusicIntentEvidence) => Promise<ShadowModelResult | null>
): Promise<MusicIntentShadowResult> {
  const started = Date.now();
  const output = await createMusicIntentShadowGraph(db, analyze).invoke({
    message: input.message,
    legacyIntent: input.legacyIntent,
    subject: '',
    explicitArtist: false,
    evidence: { exactArtist: false, exactTitle: false, artistTrackCount: 0, titleTrackCount: 0, explicitArtistSyntax: false },
    proposal: null,
    proposedIntent: input.legacyIntent,
    finalIntent: input.legacyIntent,
    verdict: 'skipped',
    confidence: 0,
    reasonCodes: [],
    provider: 'local',
    model: 'local',
    inputTokens: 0,
    outputTokens: 0
  });
  return {
    subject: output.subject,
    legacyIntent: input.legacyIntent,
    proposedIntent: output.proposedIntent,
    finalIntent: output.finalIntent,
    verdict: output.verdict,
    confidence: output.confidence,
    reasonCodes: output.reasonCodes,
    evidence: output.evidence,
    provider: output.provider,
    model: output.model,
    inputTokens: output.inputTokens,
    outputTokens: output.outputTokens,
    latencyMs: Date.now() - started
  };
}

export function saveMusicIntentAudit(db: Db, input: { runId: string; userId: string; result: MusicIntentShadowResult }) {
  const { result } = input;
  db.prepare(`INSERT INTO agent_inference_audits(
    id,run_id,user_id,subject_hash,legacy_intent,proposed_intent,final_intent,verdict,confidence,reason_codes_json,evidence_json,provider,model,input_tokens,output_tokens,latency_ms,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), input.runId, input.userId, createHash('sha256').update(normalize(result.subject)).digest('hex'),
    result.legacyIntent, result.proposedIntent, result.finalIntent, result.verdict, result.confidence,
    JSON.stringify(result.reasonCodes), JSON.stringify(result.evidence), result.provider, result.model,
    result.inputTokens, result.outputTokens, result.latencyMs, new Date().toISOString()
  );
}
