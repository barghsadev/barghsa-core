import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


MONITORING = Path(__file__).resolve().parent


class ExecutiveSloDashboardTest(unittest.TestCase):
    def test_burn_down_uses_paired_windows_from_the_selected_start(self):
        dashboard = json.loads((MONITORING / 'grafana-executive-slo-dashboard.json').read_text())
        panel, = (panel for panel in dashboard['panels'] if panel['title'] == 'Journey error-budget burn-down')
        target, = panel['targets']
        self.assertTrue(target['range'])
        self.assertFalse(target['instant'])
        style = panel['fieldConfig']['defaults']['custom']
        self.assertFalse(style['spanNulls'])
        self.assertEqual(style['lineWidth'], 0)
        query = (target['expr'].replace('$environment', 'staging').replace('$database', 'core')
                 .replace('${__from:date:seconds}', '300').replace('$__range', '35m'))

        def recorded(service, outcome, values, environment='staging', database='core', window='5m'):
            return {'series': ('barghsa:journey_attempts:rate{'
                               f'service="{service}",outcome="{outcome}",environment="{environment}",'
                               f'database="{database}",window="{window}",availability_tier="pilot"}}'),
                    'values': values}

        def check(at, budget, **expected):
            return {'expr': query.replace('${error_budget:raw}', budget), 'eval_time': at,
                    'exp_samples': [{'labels': f'{{service="{service}"}}', 'value': value}
                                    for service, value in expected.items()]}

        def delayed(values):
            return ' '.join(str(values.get(minute, '_')) for minute in range(21))

        fixture = {
            'evaluation_interval': '5m',
            'fuzzy_compare': True,
            'tests': [{
                'interval': '5m',
                'input_series': [
                    recorded('electricity', 'success', '50 50 1000 999 995 10000 1000'),
                    recorded('electricity', 'failure', '50 50 0 1 5 _ 0'),
                    recorded('saving', 'success', '995 995 995 995 995 stale stale'),
                    recorded('saving', 'failure', '5 5 5 5 5 stale stale'),
                    recorded('solar', 'success', '0+0x6'),
                    recorded('solar', 'failure', '0+0x6'),
                    recorded('consultation', 'success', '1000+0x6'),
                    recorded('electricity', 'failure', '500+0x6', environment='other'),
                    recorded('electricity', 'success', '500+0x6', database='other'),
                    recorded('electricity', 'failure', '500+0x6', window='1h'),
                ],
                'promql_expr_test': [
                    check('5m', '0.005'),
                    check('10m', '0.005', electricity=1, saving=0),
                    check('15m', '0.005', electricity=0.9, saving=0),
                    check('20m', '0.005', electricity=0.6, saving=0),
                    check('20m', '0.001', electricity=-1, saving=-4),
                    check('25m', '0.005'),
                    check('30m', '0.005', electricity=0.7),
                ],
            }, {
                'interval': '1m',
                'input_series': [
                    recorded('electricity', 'success', delayed({9: 50, 14: 1000, 19: 999})),
                    recorded('electricity', 'failure', delayed({9: 50, 14: 0, 19: 1})),
                ],
                'promql_expr_test': [
                    check('10m', '0.005'),
                    check('15m', '0.005', electricity=1),
                    check('20m', '0.005', electricity=0.9),
                ],
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            test_file = Path(directory) / 'executive-slo-test.yml'
            test_file.write_text(json.dumps(fixture))
            subprocess.run([os.environ.get('PROMTOOL', 'promtool'), 'test', 'rules', str(test_file)],
                           check=True, timeout=20)


if __name__ == '__main__':
    unittest.main()
