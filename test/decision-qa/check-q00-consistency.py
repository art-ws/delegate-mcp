#!/usr/bin/env python3
"""Static consistency checks for Q00's independent synthetic fixtures only."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).parent
semantic = json.loads((ROOT / 'semantic-vectors.json').read_text())
contract = json.loads((ROOT / 'contract-vectors.json').read_text())
plan = (ROOT / 'PLAN.md').read_text()
errors = []
def need(condition, message):
    if not condition:
        errors.append(message)

responses = semantic['responses']
by_id = {case['id']: case for case in responses}
need(len(by_id) == len(responses), 'response case IDs are unique')
base_case = by_id['R-FULL-VALID-BASELINE']
base = base_case['response']
base_req = base_case['prepared_request']
need(base_req['questions']['q-choice']['criteria'] == {'yes':'affirmative','no':'negative'}, 'baseline Choice criteria are yes/no')
need(base['answers']['q-choice']['choice'] in base_req['questions']['q-choice']['criteria'], 'baseline Choice answer is requested')
need(set(base['answers']['q-choice']['probabilities']) == set(base_req['questions']['q-choice']['criteria']), 'baseline Choice probability keys match criteria')
need(base['answers']['q-score']['legend'] == {'0':'low','1':'middle','2':'high'}, 'baseline score legend matches criteria')
need(sum(base['answers']['q-score']['probabilities'].values()) == 1.0, 'baseline score probabilities sum to one')
need(sum(i*base['answers']['q-score']['probabilities'][str(i)] for i in range(3)) == base['answers']['q-score']['score'], 'baseline score expectation matches')
need(base['usage'] == {'input_tokens':12,'output_tokens':5,'cost':0.001}, 'baseline mandatory usage and optional cost are valid')

def flatten(obj, prefix=''):
    if isinstance(obj, dict):
        out = {}
        for k,v in obj.items(): out.update(flatten(v, f'{prefix}.{k}' if prefix else str(k)))
        return out
    if isinstance(obj, list):
        out = {}
        for i,v in enumerate(obj): out.update(flatten(v, f'{prefix}.{i}'))
        return out
    return {prefix: obj}
base_flat = flatten(base, 'response')
for case in responses:
    cid=case['id']
    if cid == 'R-FULL-VALID-BASELINE':
        continue
    need(case.get('baseline_id') == 'R-FULL-VALID-BASELINE', f'{cid}: names full baseline')
    paths=case.get('changed_json_paths', [])
    need(bool(paths), f'{cid}: declares changed JSON path')
    if cid == 'R-HTML-NOT-JSON':
        need(case.get('transport_body') == '<!doctype html><html><body>synthetic upstream error</body></html>', 'HTML case has exact synthetic bytes')
        need(paths == ['transport.body_bytes'], 'HTML case names transport body boundary')
        continue
    actual=flatten(case['response'], 'response')
    diffs={k for k in set(base_flat)|set(actual) if base_flat.get(k,object()) != actual.get(k,object())}
    declared=set(paths)
    uncovered=[path for path in diffs if not any(path == p or path.startswith(p+'.') for p in declared)]
    need(not uncovered, f'{cid}: undeclared response diffs {sorted(uncovered)}')
    if case['expected'].get('valid') is True:
        need(set(case['response']['answers']) == set(case['prepared_request']['questions']), f'{cid}: exact answer IDs')
        choice=case['response']['answers']['q-choice']; opts=case['prepared_request']['questions']['q-choice']['criteria']
        need(choice['choice'] in opts, f'{cid}: Choice answer is requested')
        if 'probabilities' in choice:
            probs=choice['probabilities']
            need(set(probs)==set(opts), f'{cid}: Choice probability keys match')
            need(abs(sum(probs.values())-1)<=0.02, f'{cid}: Choice probability sum valid')
            need(probs[choice['choice']] >= max(probs.values()), f'{cid}: selected Choice is maximal')
        need(0 <= case['response']['answers']['q-noul']['noul'] <= 1, f'{cid}: Noul is in range')
        score=case['response']['answers']['q-score']; sp=score.get('probabilities')
        if sp is not None:
            need(set(sp)=={'0','1','2'}, f'{cid}: Score probability keys match')
            need(abs(sum(sp.values())-1)<=0.02, f'{cid}: Score sum valid')
            need(abs(score['score']-sum(int(i)*v for i,v in sp.items())) <= 0.06, f'{cid}: Score expectation valid')
        if 'legend' in score: need(score['legend']=={'0':'low','1':'middle','2':'high'}, f'{cid}: Score legend valid')
        usage=case['response'].get('usage')
        need(isinstance(usage,dict) and all(type(usage.get(k)) is int and usage[k]>=0 for k in ('input_tokens','output_tokens')), f'{cid}: mandatory usage counts valid')
        need('cost' not in usage or usage['cost']>=0, f'{cid}: cost valid')
    else:
        need(cid in ('R-MISSING-USAGE','R-WRONG-ID','R-WRONG-TYPE','R-UNKNOWN-CHOICE','R-CHOICE-PROBABILITY-KEYS','R-CHOICE-MAXIMUM','R-OUT-OF-RANGE-NONFINITE','R-SCORE-LEGEND','R-SCORE-PROBABILITY-KEYS','R-PROB-SUM','R-SCORE-EXPECTATION','R-USAGE','R-USAGE-COST','R-USAGE-OUTPUT-TOKENS'), f'{cid}: expected rejection case is enumerated')
        need('UPSTREAM_PROTOCOL' in json.dumps(case['expected']), f'{cid}: expected protocol rejection')

assess={c['id']:c for c in semantic['assessment']}
pos=assess['A-POLICY-VALID-ID']; bad=assess['A-POLICY-BAD-ID']; wrong=assess['A-POLICY-BAD-TYPE']
need(list(pos['prepared_args']['policy'])==['q-choice'], 'policy positive uses existing external ID')
need(pos['prepared_args']['policy']['q-choice']=={'type':'choice','min_probability':0.5}, 'policy positive rule form-valid')
need(list(bad['prepared_args']['policy'])==['absent-question'] and bad['prepared_args']['policy']['absent-question']=={'type':'choice','min_probability':0.5}, 'unknown policy ID case has valid rule')
need('assessment_input' not in bad and bad.get('stage')=='prepare semantic validation before assessment', 'unknown ID fails in prepare before assessment')
need(wrong['prepared_args']['policy']['q-choice']=={'type':'noul','false_max':0.2,'true_min':0.8}, 'wrong-type policy is form-valid under existing ID')

cases={c['id']:c for c in contract['cases']}
can=cases['V-SECRET-CANARIES']['fixture_setup']
need(can['config']['decision']['api_key']=='env:Q00_SYNTHETIC_KEY', 'canary setup uses env-reference')
need(can['env_mapping']['Q00_SYNTHETIC_KEY']=='SYNTHETIC_Q00_KEY_CANARY_DO_NOT_USE', 'canary mapping injected synthetically')
need(set(can['failure'])=={'transport','event_sink'}, 'transport and sink failures are separate')
need(any('context in DecisionsRequest state body' in x for x in can['expected_surfaces']['allowed']), 'context is allowed in request surfaces')
need(can['s2_setup']['input']=='fixture_setup.config.decision', 'S2 receives decision block only')
need(can['s2_setup']['options']=={'env':'fixture_setup.env_mapping','home':'/tmp/q00-synthetic-home','legacyMetricsFile':'/tmp/q00-synthetic-legacy-metrics.jsonl'}, 'S2 receives exact injected options and synthetic absolute paths')
need(can['s2_setup']['expected']=='status=ready; pass returned setup.config to the decision harness', 'S2 ready config is passed to harness')
need(can['s2_setup']['decision_metrics_file']=='absent', 'decision.metrics_file remains absent')
need('loadDecisionSetup(fixture_setup.config.decision, {env: fixture_setup.env_mapping, home: \"/tmp/q00-synthetic-home\", legacyMetricsFile: \"/tmp/q00-synthetic-legacy-metrics.jsonl\"})' in can['resolver'], 'resolver states the exact S2 call')
need('separate synthetic startup/legacy provider spy setup' in can['legacy_startup']['purpose'], 'legacy providers are resolved in separate startup setup')
need(can['legacy_startup']['expected_legacy_transport_calls']==0, 'legacy provider spy expects zero calls')
need(can['failure']['transport']['expected_outcome']=={'code':'NETWORK_ERROR','isError':True}, 'transport failure has NETWORK_ERROR error outcome')
need(can['failure']['event_sink']['expected_outcome']=={'result':'decision','isError':False,'stderr':'safe warning; neither canary reflected'}, 'sink failure preserves decision with safe warning')
for phase in ('transport','event_sink'):
    failure=can['failure'][phase]
    need(failure['capture']['post_count']==1, f'{phase}: exactly one captured POST')
    need(failure['capture']['authorization']=='Bearer SYNTHETIC_Q00_KEY_CANARY_DO_NOT_USE', f'{phase}: Bearer canary is captured in Authorization')
    need('isolated in-memory' in failure['capture']['key_location'], f'{phase}: Authorization capture is isolated in memory')
need(can['failure']['event_sink']['successful_response']=={'model':'typesafe/jev-1.13','answers':{'q':{'type':'noul','noul':0.9}},'usage':{'input_tokens':1,'output_tokens':0}}, 'sink-failure phase has a concrete valid Noul response')
need('For each canary' in can['oracle'] and 'only its explicitly forbidden surfaces' in can['oracle'], 'canary scans are per-canary and surface-specific')
need('key in request body, public outputs, or sinks' in can['expected_surfaces']['forbidden'], 'key forbidden surfaces are explicit')
need('key and context absent from reflected safe errors, normal logs, and stderr' in can['expected_surfaces']['forbidden'], 'both canaries forbidden in reflected safe errors/logs/stderr')
need('scan every forbidden surface for both exact canaries' not in can['oracle'], 'oracle does not over-scan allowed context surfaces')
middle=assess['A-NOUL-BETWEEN']['expected']
need(middle=={'status':'uncertain','value':None,'reasons':['ambiguous_probability']}, 'Noul middle assessment has the S4 ambiguous_probability reason')
need(assess['A-NOUL-BETWEEN']['assessment_input']['answer']['noul']==0.5, 'Noul middle value remains 0.5')
need(assess['A-NOUL-BETWEEN']['prepared_args']['policy']['q-noul']=={'type':'noul','false_max':0.2,'true_min':0.8}, 'Noul interval boundaries remain unchanged')
need(cases['V-UNKNOWN-API-KEY-ARG']['expected'].startswith('INVALID_ARGUMENT'), 'unknown api_key remains separate invalid-argument control')
need(plan.count('| AC-') == 26, 'acceptance map retains 26 AC rows')
need('14 entries' in plan and '146 entries' in plan, 'provider coverage retains 14 fields and 146 slugs')
need(all(f'| M{i} |' in plan for i in range(1,7)), 'M1-M6 are retained')
need(len(responses)==18, '18 response cases are retained')
and_fail=assess['A-CHOICE-AND-FAIL']
need(and_fail['expected']=={'status':'uncertain','value':'a','reasons':['below_margin']}, 'corrected Choice AND fixture remains intact')
need(bool(semantic['superseded_attempts']), 'historical attempts are retained')

if errors:
    print('FAIL')
    for error in errors: print(f'- {error}')
    raise SystemExit(1)
print(f'PASS: {len(responses)} response cases, {len(semantic["assessment"])} assessment cases, canary surfaces, 26 AC, provider 14/146, M1-M6')
