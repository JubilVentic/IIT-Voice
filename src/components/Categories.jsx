import { useEffect, useRef } from 'react';
import { Field } from './UI.jsx';
import { useVoice } from '../lib.js';

export function CategoryOptions({ area = '' }) {
  const { data } = useVoice();
  return data.category_groups.filter(group => !area || group.name === area).map(group => <optgroup key={group.name} label={group.name}>
    {group.categories.map(category => <option key={category}>{category}</option>)}
  </optgroup>);
}

export function CategoryFields({ primary, categories, onChange, disabled = false, analysis = null }) {
  const { data } = useVoice();
  const details = useRef(null);
  const expandToken = analysis?.categories?.length > 1 ? analysis.analysis_token : null;
  useEffect(() => { if (expandToken) details.current.open = true; }, [expandToken]);
  return <div className="category-fields">
    <Field label="Primary category" help="Guides the recommended responsible office. Select other applicable categories below.">
      <select name="category" disabled={disabled} value={primary} onChange={e => onChange(e.target.value, [e.target.value, ...categories.filter(category => category !== e.target.value && (category !== primary || categories.length > 1 || analysis?.categories?.includes(category)))])}>
        <CategoryOptions/>
      </select>
    </Field>
    {analysis?.category && <p className="meta" role="status">{analysis.categories?.length > 1 ? `AI suggested ${analysis.categories.length - 1} additional ${analysis.categories.length === 2 ? 'category' : 'categories'}. Review the selections below.` : 'AI found no additional category supported by this photo.'} You can add or remove categories.</p>}
    <details ref={details} className="category-selection"><summary>Additional categories · {Math.max(0, categories.length - 1)} selected</summary><fieldset><legend className="sr-only">Applicable categories</legend>
      <p className="meta">Photo analysis checks every category and selects all supported matches. A concern can span several categories. It will appear in every matching filter as one report.</p>
      <div className="category-groups">{data.category_groups.map(group => <div key={group.name} className="category-group">
        <h4>{group.name}</h4>
        {group.categories.map(category => <label key={category} className="check">
          <input type="checkbox" name="categories" value={category} checked={categories.includes(category)} disabled={disabled || category === primary}
            onChange={e => onChange(primary, e.target.checked ? [...categories, category] : categories.filter(item => item !== category))}/>
          <span>{category}{category === primary && <small>Primary</small>}</span>
        </label>)}
      </div>)}</div>
    </fieldset></details>
  </div>;
}
