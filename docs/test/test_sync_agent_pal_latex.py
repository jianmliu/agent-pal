import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('sync',Path(__file__).parents[1]/'sync-agent-pal-latex.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class InlineCodeTests(unittest.TestCase):
 def test_percent_and_hash_inside_bold_are_escaped(self):
  rendered=sync.inline('**At `#537`, `5%` is the threshold.**')
  self.assertIn(r'\#',rendered)
  self.assertIn(r'\%',rendered)
  self.assertNotIn(r'\nolinkurl',rendered)
 def test_short_code_words_remain_intact(self):
  self.assertIn('medium',sync.inline('`medium`'))
 def test_code_unicode_is_renderable(self):
  rendered=sync.inline('`42 → 43`')
  self.assertNotIn('→',rendered)
  self.assertIn(r'\rightarrow',rendered)
class WideTableTests(unittest.TestCase):
 def test_wide_tables_use_landscape(self):
  header='| '+' | '.join(['Column']*10)+' |'
  divider='| '+' | '.join(['---']*10)+' |'
  self.assertIn(r'\begin{landscape}',sync.table([header,divider,header]))
class DocumentTests(unittest.TestCase):
 def test_fenced_citation_is_rendered_as_code(self):
  self.assertIn(r'\begin{CodeBlock}',sync.generate())
if __name__=='__main__':unittest.main()
