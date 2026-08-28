/**
 * api/[...path].js
 *
 * Single catch-all serverless function. Vercel's Hobby plan caps deployments
 * at 12 serverless functions; this project previously had 16 files directly
 * under api/, each becoming its own function. Consolidating into one
 * catch-all function + a static route table keeps the deployment to exactly
 * 1 function while preserving every existing /api/* URL unchanged.
 *
 * All actual handler logic lives under handlers/ (unchanged from its
 * previous location under api/) and is imported statically below -- static
 * imports are required (not a runtime dynamic import() with a computed
 * path) so Vercel's build-time bundler can trace and include every handler
 * file in the deployment.
 *
 * For a catch-all route file named [...path].js, Vercel's Node.js runtime
 * populates req.query.path as an array of the path segments after /api/
 * (e.g. /api/members/abc123 -> req.query.path === ['members', 'abc123']).
 */

import allHandler from '../handlers/all.js';
import publicJobsHandler from '../handlers/public-jobs.js';
import publicDataHandler from '../handlers/public-data.js';
import meHandler from '../handlers/me.js';
import authLoginHandler from '../handlers/auth/login.js';
import authLogoutHandler from '../handlers/auth/logout.js';
import authChangePasswordHandler from '../handlers/auth/change-password.js';
import membersIndex from '../handlers/members/index.js';
import membersId from '../handlers/members/[id].js';
import membersIdLists from '../handlers/members/[id]/lists.js';
import holidays from '../handlers/holidays.js';
import jobsIndex from '../handlers/jobs/index.js';
import jobsId from '../handlers/jobs/[id].js';
import jobsIdCandidates from '../handlers/jobs/[id]/candidates.js';
import candidatesId from '../handlers/candidates/[id].js';
import okrsIndex from '../handlers/okrs/index.js';
import okrsId from '../handlers/okrs/[id].js';
import okrsIdContributions from '../handlers/okrs/[id]/contributions.js';
import myGoalsIndex from '../handlers/my-goals/index.js';
import myGoalsId from '../handlers/my-goals/[id].js';
import myGoalsIdReview from '../handlers/my-goals/[id]/review.js';
import myGoalsIdSubmit from '../handlers/my-goals/[id]/submit.js';
import okrProgressIndex from '../handlers/okr-progress/index.js';
import okrTasksIndex from '../handlers/okr-tasks/index.js';
import okrTasksId from '../handlers/okr-tasks/[id].js';
import evalsIndex from '../handlers/evals/index.js';
import evalsId from '../handlers/evals/[id].js';
import calibrationOverrides from '../handlers/calibration/[quarter]/overrides.js';
import oneononesIndex from '../handlers/oneonones/index.js';
import accountsIndex from '../handlers/accounts/index.js';
import accountsId from '../handlers/accounts/[id].js';
import accountsIdResetPassword from '../handlers/accounts/[id]/reset-password.js';
import accountsIdUnlock from '../handlers/accounts/[id]/unlock.js';
import accountsIdStatus from '../handlers/accounts/[id]/status.js';
import accountsIdTalentSearchAccess from '../handlers/accounts/[id]/talent-search-access.js';
import talentSearchPolicyIndex from '../handlers/talent-search-policy/index.js';
import talentSearchPolicyLevel1Rules from '../handlers/talent-search-policy/level1-rules.js';
import talentSearchPolicyCommonFitWeights from '../handlers/talent-search-policy/common-fit-weights.js';
import talentSearchPolicyJobFitWeights from '../handlers/talent-search-policy/job-fit-weights.js';
import talentSearchPolicyEvidenceCoefficients from '../handlers/talent-search-policy/evidence-coefficients.js';
import talentSearchPolicyThresholds from '../handlers/talent-search-policy/thresholds.js';
import talentSearchPolicyDraft from '../handlers/talent-search-policy/draft.js';
import talentSearchPolicyDraftApply from '../handlers/talent-search-policy/draft/apply.js';
import talentSearchPolicyVersions from '../handlers/talent-search-policy/versions/index.js';
import talentSearchPolicyVersionRestore from '../handlers/talent-search-policy/versions/[id]/restore.js';
import talentSearchExtensionToken from '../handlers/talent-search-extension-token/index.js';
import talentSearchProjectsIndex from '../handlers/talent-search-projects/index.js';
import talentSearchProjectsId from '../handlers/talent-search-projects/[id].js';
import talentSearchProjectsIdApprove from '../handlers/talent-search-projects/[id]/approve.js';
import talentSearchProjectsIdCandidates from '../handlers/talent-search-projects/[id]/candidates.js';
import talentSearchProjectsIdCandidateId from '../handlers/talent-search-projects/[id]/candidates/[candidateId].js';
import talentSearchJobTemplatesIndex from '../handlers/talent-search-job-templates/index.js';
import auditLogIndex from '../handlers/audit-log/index.js';
import revenueIndex from '../handlers/revenue/index.js';
import revenueTarget from '../handlers/revenue/target.js';

const ROUTES = [
  { pattern: ['all'], handler: allHandler },
  { pattern: ['public-jobs'], handler: publicJobsHandler },
  { pattern: ['public-data'], handler: publicDataHandler },
  { pattern: ['me'], handler: meHandler },
  { pattern: ['auth', 'login'], handler: authLoginHandler },
  { pattern: ['auth', 'logout'], handler: authLogoutHandler },
  { pattern: ['auth', 'change-password'], handler: authChangePasswordHandler },
  { pattern: ['members'], handler: membersIndex },
  { pattern: ['members', ':id'], handler: membersId },
  { pattern: ['members', ':id', 'lists'], handler: membersIdLists },
  { pattern: ['holidays'], handler: holidays },
  { pattern: ['jobs'], handler: jobsIndex },
  { pattern: ['jobs', ':id'], handler: jobsId },
  { pattern: ['jobs', ':id', 'candidates'], handler: jobsIdCandidates },
  { pattern: ['candidates', ':id'], handler: candidatesId },
  { pattern: ['okrs'], handler: okrsIndex },
  { pattern: ['okrs', ':id'], handler: okrsId },
  { pattern: ['okrs', ':id', 'contributions'], handler: okrsIdContributions },
  { pattern: ['my-goals'], handler: myGoalsIndex },
  { pattern: ['my-goals', ':id'], handler: myGoalsId },
  { pattern: ['my-goals', ':id', 'review'], handler: myGoalsIdReview },
  { pattern: ['my-goals', ':id', 'submit'], handler: myGoalsIdSubmit },
  { pattern: ['okr-progress'], handler: okrProgressIndex },
  { pattern: ['okr-tasks'], handler: okrTasksIndex },
  { pattern: ['okr-tasks', ':id'], handler: okrTasksId },
  { pattern: ['evals'], handler: evalsIndex },
  { pattern: ['evals', ':id'], handler: evalsId },
  { pattern: ['calibration', ':quarter', 'overrides'], handler: calibrationOverrides },
  { pattern: ['oneonones'], handler: oneononesIndex },
  { pattern: ['accounts'], handler: accountsIndex },
  { pattern: ['accounts', ':id'], handler: accountsId },
  { pattern: ['accounts', ':id', 'reset-password'], handler: accountsIdResetPassword },
  { pattern: ['accounts', ':id', 'unlock'], handler: accountsIdUnlock },
  { pattern: ['accounts', ':id', 'status'], handler: accountsIdStatus },
  { pattern: ['accounts', ':id', 'talent-search-access'], handler: accountsIdTalentSearchAccess },
  { pattern: ['talent-search-policy'], handler: talentSearchPolicyIndex },
  { pattern: ['talent-search-policy', 'level1-rules'], handler: talentSearchPolicyLevel1Rules },
  { pattern: ['talent-search-policy', 'common-fit-weights'], handler: talentSearchPolicyCommonFitWeights },
  { pattern: ['talent-search-policy', 'job-fit-weights'], handler: talentSearchPolicyJobFitWeights },
  { pattern: ['talent-search-policy', 'evidence-coefficients'], handler: talentSearchPolicyEvidenceCoefficients },
  { pattern: ['talent-search-policy', 'thresholds'], handler: talentSearchPolicyThresholds },
  { pattern: ['talent-search-policy', 'draft'], handler: talentSearchPolicyDraft },
  { pattern: ['talent-search-policy', 'draft', 'apply'], handler: talentSearchPolicyDraftApply },
  { pattern: ['talent-search-policy', 'versions'], handler: talentSearchPolicyVersions },
  { pattern: ['talent-search-policy', 'versions', ':id', 'restore'], handler: talentSearchPolicyVersionRestore },
  { pattern: ['talent-search-extension-token'], handler: talentSearchExtensionToken },
  { pattern: ['talent-search-projects'], handler: talentSearchProjectsIndex },
  { pattern: ['talent-search-projects', ':id'], handler: talentSearchProjectsId },
  { pattern: ['talent-search-projects', ':id', 'approve'], handler: talentSearchProjectsIdApprove },
  { pattern: ['talent-search-projects', ':id', 'candidates'], handler: talentSearchProjectsIdCandidates },
  { pattern: ['talent-search-projects', ':id', 'candidates', ':candidateId'], handler: talentSearchProjectsIdCandidateId },
  { pattern: ['talent-search-job-templates'], handler: talentSearchJobTemplatesIndex },
  { pattern: ['audit-log'], handler: auditLogIndex },
  { pattern: ['revenue'], handler: revenueIndex },
  { pattern: ['revenue', 'target'], handler: revenueTarget },
];

function matchRoute(segments) {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    let ok = true;
    const params = {};
    for (let i = 0; i < route.pattern.length; i++) {
      const p = route.pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = segments[i];
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

export default async function handler(req, res) {
  // Derive segments directly from the URL path rather than req.query's
  // catch-all key (observed to be inconsistently named across Vercel
  // runtime versions -- sometimes "path", sometimes "...path"). Parsing
  // the URL ourselves is robust regardless of that naming.
  const pathname = (req.url || '').split('?')[0];
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const match = matchRoute(segments);
  if (!match) return res.status(404).json({ error: 'Not found' });
  Object.assign(req.query, match.params);
  return match.handler(req, res);
}
