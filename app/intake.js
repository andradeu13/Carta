/* Convierte lo que dictas o escribes («el martes enviar la propuesta, jueves 5 DMs por la noche 30 min»)
   en tareas de la semana. Reglas simples y predecibles; siempre queda una vista previa editable. */
(function (root) {
  const DAYS = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };
  const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const DAY_RE = /\b(?:(?:el|este|del|los|para el|para este)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
  const NUM = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

  function minutesOf(p) {
    let m = p.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hora|horas)\b/);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    m = p.match(/(\d+)\s*(?:min|mins|minutos?)\b/);
    if (m) return +m[1];
    if (/\bmedia hora\b/.test(p)) return 30;
    m = p.match(/\b(un|una|dos|tres|cuatro|cinco|seis)\s+horas?\b/);
    if (m) return NUM[m[1]] * 60;
    return 0;
  }

  /* text: lo dictado. today: 0 = lunes … 6 = domingo. Devuelve [{title, day, block, mins}] */
  function parseTasks(text, today) {
    const base = Math.max(0, Math.min(6, today || 0));
    const raw = String(text || '').replace(/\r/g, '\n')
      .replace(/\s+y\s+(?=(?:el\s+|este\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|hoy|ma[nñ]ana)\b)/gi, '\n')
      .replace(/\s+(?:luego|despu[eé]s|tambi[eé]n)\s+(?=(?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b)/gi, '\n');
    const parts = raw.split(/[\n;]+|\.\s+|,\s*(?=(?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b)/i)
      .map(s => s.trim()).filter(Boolean);
    const out = [];
    let cur = null;
    parts.forEach(seg => {
      // «lunes: A, B, C» → un solo día para varias tareas
      const head = plain(seg).match(/^(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s*[:\-]\s*/);
      let items = [seg];
      if (head) { cur = DAYS[head[1]]; items = seg.slice(head[0].length).split(/\s*,\s*/).filter(Boolean); }
      items.forEach(item => {
        let p = plain(item), title = item, day = null, block = null;
        const dm = p.match(DAY_RE);
        if (dm) day = DAYS[dm[1]];
        else if (/\bpasado manana\b/.test(p)) day = base + 2;
        else if (/\bhoy\b/.test(p)) day = base;
        else if (/\bmanana\b/.test(p) && !/\b(?:por|en|de|a)\s+la\s+manana\b/.test(p) && !/\bmanana\s+(?:temprano|a las)\b/.test(p)) day = base + 1;
        if (/\b(?:por|en|de)\s+la\s+manana\b|\btemprano\b|\bal despertar\b/.test(p)) block = 'am';
        else if (/\b(?:noche|tarde|despues del trabajo)\b/.test(p)) block = 'pm';
        const mins = minutesOf(p);
        // limpiar el título
        title = title
          .replace(/\b(?:el|este|del|los|para el|para este)?\s*(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi, ' ')
          .replace(/\bpasado ma[nñ]ana\b|\bhoy\b/gi, ' ')
          .replace(/\bma[nñ]ana\b(?!\s*,?\s*$)(?=\s|$)/gi, m => (/\b(?:por|en|de|a)\s+la\s+ma[nñ]ana\b/i.test(item) ? m : ' '))
          .replace(/\b(?:por|en|de)\s+la\s+(?:noche|tarde|ma[nñ]ana)\b|\bpor la noche\b|\btemprano\b/gi, ' ')
          .replace(/\b\d+(?:[.,]\d+)?\s*(?:h|hr|hrs|horas?|min|mins|minutos?)\b/gi, ' ')
          .replace(/\bmedia hora\b|\b(?:un|una|dos|tres|cuatro|cinco|seis)\s+horas?\b/gi, ' ')
          .replace(/^\s*(?:y\s+)?(?:tengo que|tengo|debo|necesito|quiero|voy a|hay que|recu[eé]rdame|me toca)\s+/i, '')
          .replace(/^\s*(?:para|de|a|que|y|luego|despu[eé]s|tambi[eé]n)\s+/i, '')
          .replace(/[\s,:;\-–]+$/g, '').replace(/\s+(?:y|e|o)$/i, '').replace(/^[\s,:;\-–•*\d.)]+/, '').replace(/\s{2,}/g, ' ').trim();
        if (title.length < 2) return;
        if (day !== null) cur = Math.min(6, day);
        out.push({ title: title.charAt(0).toUpperCase() + title.slice(1), day: day !== null ? Math.min(6, day) : (cur !== null ? cur : base), block: block || 'pm', mins: mins || 30 });
      });
    });
    return out.slice(0, 40);
  }
  const api = { parseTasks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Intake = api;
})(typeof window !== 'undefined' ? window : globalThis);
