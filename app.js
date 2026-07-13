/* ==================== Firebase init ==================== */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

let currentUser = null;
let householdId = null;
let isOwner = false;

/* ==================== utilidades de fecha ==================== */
function pad(n){ return n<10 ? '0'+n : ''+n; }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parseDate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function toStr(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function addDays(s,n){ const d=parseDate(s); d.setDate(d.getDate()+n); return toStr(d); }
function diffDays(s1,s2){ const d1=parseDate(s1), d2=parseDate(s2); return Math.round((d2-d1)/86400000); }
function fmtHuman(s){
  if(!s) return '';
  const d = parseDate(s);
  const dias=['dom','lun','mar','mié','jue','vie','sáb'];
  const dd=pad(d.getDate()), mm=pad(d.getMonth()+1), yyyy=d.getFullYear();
  const fechaNum = (prefs.fecha==='mdy') ? (mm+'/'+dd+'/'+yyyy) : (dd+'/'+mm+'/'+yyyy);
  return dias[d.getDay()]+' '+fechaNum;
}
function fmtHora(hhmm){
  if(!hhmm || hhmm==='_default') return '';
  if(prefs.hora!=='12h') return hhmm;
  const [h,m] = hhmm.split(':').map(Number);
  let h12 = h%12; if(h12===0) h12=12;
  return h12+':'+pad(m)+' '+(h>=12?'PM':'AM');
}
function loadPrefs(){
  const raw = localStorage_safe_get('prefs-'+currentUser.uid);
  if(raw){ try{ prefs = Object.assign({fecha:'dmy',hora:'24h'}, JSON.parse(raw)); }catch(e){} }
}
function savePrefs(){ localStorage_safe_set('prefs-'+currentUser.uid, JSON.stringify(prefs)); }
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ==================== toast ==================== */
let toastTimer;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ==================== referencias Firestore ==================== */
function householdRef(){ return db.collection('households').doc(householdId); }
function petsCol(){ return householdRef().collection('pets'); }
function medsCol(petId){ return petsCol().doc(petId).collection('meds'); }
function logsCol(petId){ return petsCol().doc(petId).collection('logs'); }
function docsCol(petId){ return petsCol().doc(petId).collection('documentos'); }
function userRef(uid){ return db.collection('users').doc(uid); }

async function safeGetDoc(ref){
  try{ const s = await ref.get(); return s.exists ? s.data() : null; }
  catch(e){ console.error(e); return null; }
}
async function safeSetDoc(ref, data){
  try{ await ref.set(data, {merge:true}); }
  catch(e){ console.error(e); toast('Error guardando (revisá tu conexión)'); }
}
async function safeDeleteDoc(ref){
  try{ await ref.delete(); }catch(e){ console.error(e); }
}
async function safeListCol(ref){
  try{ const s = await ref.get(); return s.docs.map(d=>Object.assign({id:d.id}, d.data())); }
  catch(e){ console.error(e); return []; }
}

/* ==================== estado en memoria ==================== */
let pets = [];
let activePetId = null;
let meds = [];
let selectedDate = todayStr();
let editingMedId = null;
let medTipoActual = 'fijo';
let diasVariable = [];
let horariosForm = [];
let recDosisModo = 'fija';
let vecesRecurrente = [];
let editingDocId = null;
let prefs = {fecha:'dmy', hora:'24h'};
let weekStart = null;

/* ==================== AUTENTICACIÓN ==================== */
document.getElementById('btnGoogleLogin').addEventListener('click', async ()=>{
  try{ await auth.signInWithPopup(provider); }
  catch(e){ console.error(e); toast('No se pudo iniciar sesión'); }
});
document.getElementById('btnLogout').addEventListener('click', ()=>auth.signOut());

document.getElementById('btnCrearHogar').addEventListener('click', async ()=>{
  const newRef = db.collection('households').doc();
  await newRef.set({
    owner: currentUser.uid,
    ownerEmail: currentUser.email,
    allowedEmails: [currentUser.email],
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await userRef(currentUser.uid).set({householdId: newRef.id}, {merge:true});
  householdId = newRef.id;
  await bootstrapApp();
});

document.getElementById('btnUnirme').addEventListener('click', async ()=>{
  const code = document.getElementById('inputJoinCode').value.trim();
  const errEl = document.getElementById('joinError');
  errEl.textContent = '';
  if(!code){ errEl.textContent = 'Pegá el código primero.'; return; }
  try{
    const snap = await db.collection('households').doc(code).get();
    if(!snap.exists){ errEl.textContent = 'Ese código no existe.'; return; }
    await userRef(currentUser.uid).set({householdId: code}, {merge:true});
    householdId = code;
    await bootstrapApp();
  }catch(e){
    console.error(e);
    errEl.textContent = 'Tu email todavía no fue autorizado para este hogar. Pedile al dueño que lo agregue en Ajustes > Compartir.';
  }
});

auth.onAuthStateChanged(async (user)=>{
  if(!user){
    currentUser = null;
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('joinCreateCard').style.display = 'none';
    return;
  }
  currentUser = user;
  const uDoc = await safeGetDoc(userRef(user.uid));
  if(uDoc && uDoc.householdId){
    householdId = uDoc.householdId;
    await bootstrapApp();
  } else {
    document.getElementById('joinCreateCard').style.display = 'block';
  }
});

async function bootstrapApp(){
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  loadPrefs();
  weekStart = mondayOf(todayStr());
  const h = await safeGetDoc(householdRef());
  isOwner = !!(h && h.owner === currentUser.uid);
  await loadPets();
  await loadActivePet();
  await loadMeds();
  resetMedForm();
  await render();
}

/* ==================== mascotas ==================== */
async function loadPets(){
  pets = await safeListCol(petsCol());
  if(pets.length===0){
    const nuevo = {nombre:'Mi mascota'};
    const ref = await petsCol().add(nuevo);
    pets = [Object.assign({id:ref.id}, nuevo)];
  }
}
async function loadActivePet(){
  const raw = localStorage_safe_get('active-pet-'+householdId);
  activePetId = (raw && pets.some(p=>p.id===raw)) ? raw : pets[0].id;
}
function localStorage_safe_get(key){
  try{ return window.localStorage.getItem(key); }catch(e){ return null; }
}
function localStorage_safe_set(key, val){
  try{ window.localStorage.setItem(key, val); }catch(e){}
}
function getActivePet(){ return pets.find(p=>p.id===activePetId) || null; }

async function setActivePet(id){
  activePetId = id;
  localStorage_safe_set('active-pet-'+householdId, id);
  await loadMeds();
  await render();
}
async function agregarMascota(){
  const ref = await petsCol().add({nombre:'Nueva mascota'});
  await loadPets();
  await setActivePet(ref.id);
  renderPetsList();
}
async function renombrarMascota(id, nombre){
  await safeSetDoc(petsCol().doc(id), {nombre: nombre || 'Mascota'});
  await loadPets();
  render();
}
async function eliminarMascota(id){
  if(pets.length<=1){ toast('Necesitás al menos una mascota'); return; }
  if(!confirm('¿Eliminar esta mascota y todos sus datos?')) return;
  const medDocs = await safeListCol(medsCol(id));
  for(const m of medDocs) await safeDeleteDoc(medsCol(id).doc(m.id));
  const logDocs = await safeListCol(logsCol(id));
  for(const l of logDocs) await safeDeleteDoc(logsCol(id).doc(l.id));
  await safeDeleteDoc(petsCol().doc(id));
  await loadPets();
  if(activePetId===id) await setActivePet(pets[0].id);
  else { renderPetsList(); render(); }
}

/* ==================== medicaciones: cálculo ==================== */
function fechaFinMed(med){
  if(med.tipo==='fijo') return addDays(med.fechaInicio, (med.duracionDias||1)-1);
  if(med.tipo==='variable') return addDays(med.fechaInicio, (med.dosisPorDia||[]).length-1);
  return null;
}
function dosisEnFecha(med, dateStr){
  const diff = diffDays(med.fechaInicio, dateStr);
  if(diff<0) return null;
  if(med.tipo==='fijo'){ return diff <= (med.duracionDias||1)-1 ? med.dosisFija : null; }
  if(med.tipo==='variable'){ const arr=med.dosisPorDia||[]; return diff<arr.length ? arr[diff].dosis : null; }
  if(med.tipo==='recurrente'){
    const it = med.intervaloDias||1;
    if(diff % it !== 0) return null;
    if(med.dosisModo==='variable'){
      const ocurrencia = Math.floor(diff/it)+1;
      const arr = med.dosisPorCiclo||[];
      if(arr.length===0) return null;
      const idx = Math.min(ocurrencia-1, arr.length-1);
      return arr[idx].dosis;
    }
    return med.dosisRec;
  }
  return null;
}
function vezDeRecurrente(med, dateStr){
  if(med.tipo!=='recurrente') return null;
  const it = med.intervaloDias||1;
  const diff = diffDays(med.fechaInicio, dateStr);
  if(diff<0 || diff % it !== 0) return null;
  return Math.floor(diff/it)+1;
}
function horariosDe(med){
  return (med.horarios && med.horarios.length>0) ? med.horarios.slice().sort() : ['_default'];
}
function estaTomada(log, medId, horario){
  const v = log.medicacionesTomadas && log.medicacionesTomadas[medId];
  if(v==null) return false;
  if(typeof v === 'boolean') return horario==='_default' ? v : false;
  return !!v[horario];
}
function diaXdeY(med, dateStr){
  const diff = diffDays(med.fechaInicio, dateStr);
  if(diff<0) return null;
  if(med.tipo==='fijo') return {actual:diff+1, total:med.duracionDias||1};
  if(med.tipo==='variable') return {actual:diff+1, total:(med.dosisPorDia||[]).length};
  return null;
}
function proximaTomaRecurrente(med, fromStr){
  const it = med.intervaloDias||1;
  let diff = diffDays(med.fechaInicio, fromStr);
  let resto = ((diff % it)+it)%it;
  let dh = resto===0 ? 0 : (it-resto);
  return addDays(fromStr, dh);
}

async function loadMeds(){
  if(!activePetId){ meds=[]; return; }
  const arr = await safeListCol(medsCol(activePetId));
  arr.sort((a,b)=> (b.activo - a.activo) || a.fechaInicio.localeCompare(b.fechaInicio));
  meds = arr;
}
async function saveMed(med){
  const id = med.id || ('m'+Date.now());
  const data = Object.assign({}, med); delete data.id;
  await safeSetDoc(medsCol(activePetId).doc(id), data);
  return id;
}
async function deleteMed(id){ await safeDeleteDoc(medsCol(activePetId).doc(id)); }

/* ==================== registros diarios ==================== */
async function loadLog(dateStr){
  if(!activePetId) return null;
  return await safeGetDoc(logsCol(activePetId).doc(dateStr));
}
async function saveLog(log){
  const data = Object.assign({}, log);
  await safeSetDoc(logsCol(activePetId).doc(log.fecha), data);
}

/* ==================== selector de mascota ==================== */
function renderPetPicker(){
  const sel = document.getElementById('petPicker');
  if(pets.length<=1){ sel.style.display='none'; return; }
  sel.style.display = '';
  sel.innerHTML = pets.map(p=>'<option value="'+p.id+'" '+(p.id===activePetId?'selected':'')+'>'+escapeHtml(p.nombre)+'</option>').join('');
}
document.getElementById('petPicker').addEventListener('change', (e)=>setActivePet(e.target.value));

/* ==================== pastillero semanal ==================== */
function mondayOf(dateStr){
  const diaSemana = (parseDate(dateStr).getDay()+6)%7;
  return addDays(dateStr, -diaSemana);
}
function capitalizar(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

async function renderPastillero(){
  if(!weekStart) weekStart = mondayOf(todayStr());
  const cont = document.getElementById('pastillero');
  const hoy = todayStr();
  const letras = ['L','M','M','J','V','S','D'];
  const dias = [];
  for(let i=0;i<7;i++) dias.push(addDays(weekStart, i));

  const logs = await Promise.all(dias.map(ds => ds<=hoy ? loadLog(ds) : Promise.resolve(null)));

  const frag = document.createDocumentFragment();
  dias.forEach((ds,i)=>{
    const btn = document.createElement('div');
    btn.className = 'pill-day';
    if(ds===hoy) btn.classList.add('today');
    if(ds===selectedDate) btn.classList.add('selected');
    if(ds>hoy) btn.classList.add('future');
    if(ds<=hoy){
      const log = logs[i];
      if(log && log.completado) btn.classList.add('done');
      else if(ds<hoy) btn.classList.add('missed');
    }
    btn.innerHTML = '<span class="l">'+letras[i]+'</span><span class="n">'+parseDate(ds).getDate()+'</span><span class="dot"></span>';
    if(ds<=hoy) btn.addEventListener('click', ()=>{ selectedDate=ds; render(); });
    frag.appendChild(btn);
  });
  cont.innerHTML = '';
  cont.appendChild(frag);

  const meses=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dMes = parseDate(weekStart);
  document.getElementById('mesBtnTexto').textContent = capitalizar(meses[dMes.getMonth()])+' '+dMes.getFullYear();
}

document.getElementById('mesBtn').addEventListener('click', ()=>{
  const inp = document.getElementById('pastilleroJump');
  inp.value = selectedDate;
  try{ inp.showPicker(); }catch(e){ inp.click(); }
});
document.getElementById('pastilleroJump').addEventListener('change', (e)=>{
  if(!e.target.value) return;
  selectedDate = e.target.value;
  weekStart = mondayOf(selectedDate);
  render();
});

(function setupSwipeSemana(){
  const el = document.getElementById('semanaWrap');
  let startX=0, startY=0, tracking=false;
  el.addEventListener('touchstart', (e)=>{
    if(e.touches.length!==1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
  }, {passive:true});
  el.addEventListener('touchend', (e)=>{
    if(!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if(Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)*1.4){
      weekStart = addDays(weekStart, dx<0 ? 7 : -7);
      render();
    }
  }, {passive:true});
})();

/* ==================== vista Hoy ==================== */
async function renderHoy(){
  const titulo = document.getElementById('hoyTitulo');
  const esHoy = selectedDate === todayStr();
  titulo.textContent = esHoy ? 'Hoy · '+fmtHuman(selectedDate) : fmtHuman(selectedDate);

  const bannerWrap = document.getElementById('hoyBanner');
  bannerWrap.innerHTML = '';

  const listEl = document.getElementById('medsHoyList');
  const card = document.getElementById('medsHoyCard');
  const activos = meds.filter(m=>m.activo!==false);
  const delDia = [];
  activos.forEach(m=>{
    const dosis = dosisEnFecha(m, selectedDate);
    if(dosis){
      horariosDe(m).forEach(h=>delDia.push({med:m, dosis, horario:h}));
    }
  });
  delDia.sort((a,b)=>{
    const ta = a.horario==='_default' ? '' : a.horario;
    const tb = b.horario==='_default' ? '' : b.horario;
    return ta.localeCompare(tb) || a.med.nombre.localeCompare(b.med.nombre);
  });

  const log = (await loadLog(selectedDate)) || {fecha:selectedDate, sintomas:'', apetito:'', animo:'', notas:'', medicacionesTomadas:{}, completado:false};

  if(delDia.length===0){ card.style.display='none'; }
  else{
    card.style.display='';
    listEl.innerHTML='';
    delDia.forEach(({med,dosis,horario})=>{
      const row = document.createElement('label');
      row.className='chk-row';
      const checked = estaTomada(log, med.id, horario);
      const diaInfo = diaXdeY(med, selectedDate);
      let diaTxt = '';
      if(diaInfo) diaTxt = ' · Día '+diaInfo.actual+' de '+diaInfo.total;
      else { const vez = vezDeRecurrente(med, selectedDate); if(vez) diaTxt = ' · Vez '+vez; }
      const horarioTxt = horario!=='_default' ? escapeHtml(fmtHora(horario))+' · ' : '';
      row.innerHTML = '<input type="checkbox" data-medid="'+med.id+'" data-horario="'+escapeHtml(horario)+'" '+(checked?'checked':'')+'>'+
        '<div class="info"><b>'+escapeHtml(med.nombre)+'</b><div>'+horarioTxt+escapeHtml(dosis)+(med.formaIngesta?' · '+escapeHtml(med.formaIngesta):'')+diaTxt+'</div></div>';
      listEl.appendChild(row);
    });
  }

  document.getElementById('logSintomas').value = log.sintomas||'';
  document.getElementById('logApetito').value = log.apetito||'';
  document.getElementById('logAnimo').value = log.animo||'';
  document.getElementById('logNotas').value = log.notas||'';
}

async function guardarHoy(){
  const medsMarcados = {};
  document.querySelectorAll('#medsHoyList input[type=checkbox]').forEach(chk=>{
    const mid = chk.dataset.medid, hor = chk.dataset.horario;
    medsMarcados[mid] = medsMarcados[mid] || {};
    medsMarcados[mid][hor] = chk.checked;
  });
  const log = {
    fecha: selectedDate,
    sintomas: document.getElementById('logSintomas').value.trim(),
    apetito: document.getElementById('logApetito').value,
    animo: document.getElementById('logAnimo').value,
    notas: document.getElementById('logNotas').value.trim(),
    medicacionesTomadas: medsMarcados,
    completado: true
  };
  await saveLog(log);
  toast('Registro guardado');
  await render();
}

/* ==================== vista Medicación ==================== */
function resetMedForm(){
  editingMedId = null;
  medTipoActual = 'fijo';
  diasVariable = [{dia:1, dosis:''}];
  horariosForm = [];
  recDosisModo = 'fija';
  vecesRecurrente = [{dosis:''}];
  document.getElementById('medFormTitle').textContent='Agregar medicación';
  document.getElementById('medNombre').value='';
  document.getElementById('medForma').value='';
  document.getElementById('medFechaInicio').value=todayStr();
  document.getElementById('medDosisFija').value='';
  document.getElementById('medDuracion').value='';
  document.getElementById('medFechaFinFijo').value='';
  document.getElementById('medDosisRec').value='';
  document.getElementById('medIntervalo').value='';
  document.getElementById('medNotas').value='';
  document.getElementById('btnCancelarEdicionMed').style.display='none';
  setMedTipo('fijo');
  setRecDosisModo('fija');
  renderDiasVariable();
  renderHorariosForm();
  renderVecesRecurrente();
  actualizarCalculos();
}
function setRecDosisModo(modo){
  recDosisModo = modo;
  document.querySelectorAll('#recDosisModoSeg button').forEach(b=>b.classList.toggle('active', b.dataset.modo===modo));
  document.getElementById('recDosisFijaWrap').style.display = modo==='fija' ? '' : 'none';
  document.getElementById('recDosisVariableWrap').style.display = modo==='variable' ? '' : 'none';
  actualizarCalculos();
}
function renderHorariosForm(){
  const cont = document.getElementById('medHorariosList');
  cont.innerHTML='';
  horariosForm.forEach((h,idx)=>{
    const row=document.createElement('div');
    row.className='med-day-row';
    row.innerHTML = '<input type="time" value="'+h+'" data-idx="'+idx+'">'+
      '<button type="button" class="icon-btn" data-remove="'+idx+'">✕</button>';
    cont.appendChild(row);
  });
  cont.querySelectorAll('input[type=time]').forEach(inp=>{
    inp.addEventListener('input', ()=>{ horariosForm[+inp.dataset.idx]=inp.value; });
  });
  cont.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', ()=>{ horariosForm.splice(+b.dataset.remove,1); renderHorariosForm(); });
  });
}
function renderVecesRecurrente(){
  const cont = document.getElementById('medVecesRecurrente');
  cont.innerHTML='';
  vecesRecurrente.forEach((v,idx)=>{
    const row=document.createElement('div');
    row.className='med-day-row';
    row.innerHTML = '<span class="dnum mono">Vez '+(idx+1)+'</span>'+
      '<input type="text" placeholder="Dosis" value="'+escapeHtml(v.dosis)+'" data-idx="'+idx+'">'+
      (vecesRecurrente.length>1 ? '<button type="button" class="icon-btn" data-remove="'+idx+'">✕</button>' : '');
    cont.appendChild(row);
  });
  cont.querySelectorAll('input[type=text]').forEach(inp=>{
    inp.addEventListener('input', ()=>{ vecesRecurrente[+inp.dataset.idx].dosis=inp.value; actualizarCalculos(); });
  });
  cont.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', ()=>{ vecesRecurrente.splice(+b.dataset.remove,1); renderVecesRecurrente(); actualizarCalculos(); });
  });
}
function setMedTipo(tipo){
  medTipoActual = tipo;
  document.querySelectorAll('#medTipoSeg button').forEach(b=>b.classList.toggle('active', b.dataset.tipo===tipo));
  document.getElementById('medCamposFijo').style.display = tipo==='fijo' ? '' : 'none';
  document.getElementById('medCamposVariable').style.display = tipo==='variable' ? '' : 'none';
  document.getElementById('medCamposRecurrente').style.display = tipo==='recurrente' ? '' : 'none';
  actualizarCalculos();
}
function renderDiasVariable(){
  const cont = document.getElementById('medDiasVariable');
  cont.innerHTML='';
  diasVariable.forEach((d,idx)=>{
    const row = document.createElement('div');
    row.className='med-day-row';
    row.innerHTML = '<span class="dnum mono">Día '+d.dia+'</span>'+
      '<input type="text" placeholder="Dosis de este día" value="'+escapeHtml(d.dosis)+'" data-idx="'+idx+'">'+
      (diasVariable.length>1 ? '<button type="button" class="icon-btn" data-remove="'+idx+'">✕</button>' : '');
    cont.appendChild(row);
  });
  cont.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', ()=>{ diasVariable[+inp.dataset.idx].dosis=inp.value; actualizarCalculos(); });
  });
  cont.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', ()=>{
      diasVariable.splice(+b.dataset.remove,1);
      diasVariable.forEach((d,i)=>d.dia=i+1);
      renderDiasVariable(); actualizarCalculos();
    });
  });
}
function actualizarCalculos(origen){
  const inicio = document.getElementById('medFechaInicio').value || todayStr();
  if(medTipoActual==='fijo'){
    const durInput = document.getElementById('medDuracion');
    const finInput = document.getElementById('medFechaFinFijo');
    if(origen==='fin' && finInput.value){
      const dur = diffDays(inicio, finInput.value)+1;
      if(dur>0) durInput.value = dur;
    } else {
      const dur = +durInput.value || 0;
      if(dur>0) finInput.value = addDays(inicio, dur-1);
    }
    const dur = +durInput.value || 0;
    document.getElementById('medFinCalc').textContent = dur>0 ? 'Toma hasta el '+fmtHuman(addDays(inicio,dur-1))+' inclusive ('+dur+' día'+(dur===1?'':'s')+').' : '';
  } else if(medTipoActual==='variable'){
    const dur = diasVariable.length;
    document.getElementById('medFinCalcVar').textContent = dur>0 ? 'El tratamiento dura '+dur+' día'+(dur===1?'':'s')+', hasta el '+fmtHuman(addDays(inicio,dur-1))+'.' : '';
  } else if(medTipoActual==='recurrente'){
    const it = +document.getElementById('medIntervalo').value || 0;
    const el = document.getElementById('medProximaCalc');
    if(it>0){
      const prox = proximaTomaRecurrente({fechaInicio:inicio, intervaloDias:it}, todayStr());
      let dosisTxt = '';
      if(recDosisModo==='variable' && vecesRecurrente.length){
        const diff = diffDays(inicio, prox);
        const ocurrencia = Math.floor(diff/it)+1;
        const idx = Math.min(ocurrencia-1, vecesRecurrente.length-1);
        if(vecesRecurrente[idx] && vecesRecurrente[idx].dosis) dosisTxt = ' · '+vecesRecurrente[idx].dosis+' (vez '+ocurrencia+')';
      }
      el.textContent = 'Se repite cada '+it+' días. Próxima toma: '+fmtHuman(prox)+dosisTxt+'.';
    } else el.textContent='';
  }
}
async function guardarMedForm(){
  const nombre = document.getElementById('medNombre').value.trim();
  if(!nombre){ toast('Poné un nombre para la medicación'); return; }
  const fechaInicio = document.getElementById('medFechaInicio').value || todayStr();
  const formaIngesta = document.getElementById('medForma').value.trim();
  const notas = document.getElementById('medNotas').value.trim();
  const horarios = horariosForm.filter(h=>h);
  let med = { id: editingMedId, nombre, formaIngesta, fechaInicio, notas, tipo: medTipoActual, activo:true, horarios };

  if(medTipoActual==='fijo'){
    const dur = +document.getElementById('medDuracion').value;
    const dosisFija = document.getElementById('medDosisFija').value.trim();
    if(!dur || dur<1){ toast('Indicá la duración o la fecha de fin'); return; }
    if(!dosisFija){ toast('Indicá la dosis'); return; }
    med.duracionDias = dur; med.dosisFija = dosisFija;
  } else if(medTipoActual==='variable'){
    if(diasVariable.some(d=>!d.dosis.trim())){ toast('Completá la dosis de todos los días'); return; }
    med.dosisPorDia = diasVariable.map(d=>({dia:d.dia, dosis:d.dosis.trim()}));
  } else if(medTipoActual==='recurrente'){
    const it = +document.getElementById('medIntervalo').value;
    if(!it || it<1){ toast('Indicá cada cuántos días se repite'); return; }
    med.intervaloDias = it;
    med.dosisModo = recDosisModo;
    if(recDosisModo==='fija'){
      const dosisRec = document.getElementById('medDosisRec').value.trim();
      if(!dosisRec){ toast('Indicá la dosis'); return; }
      med.dosisRec = dosisRec;
    } else {
      if(vecesRecurrente.some(v=>!v.dosis.trim())){ toast('Completá la dosis de cada vez'); return; }
      med.dosisPorCiclo = vecesRecurrente.map((v,i)=>({ciclo:i+1, dosis:v.dosis.trim()}));
    }
  }

  const id = await saveMed(med);
  toast(editingMedId ? 'Medicación actualizada' : 'Medicación guardada');
  await loadMeds();
  resetMedForm();
  render();
}
function editarMed(id){
  const med = meds.find(m=>m.id===id);
  if(!med) return;
  editingMedId = id;
  document.getElementById('medFormTitle').textContent='Editar medicación';
  document.getElementById('medNombre').value=med.nombre;
  document.getElementById('medForma').value=med.formaIngesta||'';
  document.getElementById('medFechaInicio').value=med.fechaInicio;
  document.getElementById('medNotas').value=med.notas||'';
  horariosForm = (med.horarios||[]).slice();
  renderHorariosForm();
  setMedTipo(med.tipo);
  if(med.tipo==='fijo'){
    document.getElementById('medDosisFija').value=med.dosisFija||'';
    document.getElementById('medDuracion').value=med.duracionDias||'';
    document.getElementById('medFechaFinFijo').value=fechaFinMed(med)||'';
  } else if(med.tipo==='variable'){
    diasVariable = (med.dosisPorDia||[{dia:1,dosis:''}]).map(d=>({dia:d.dia, dosis:d.dosis}));
    renderDiasVariable();
  } else if(med.tipo==='recurrente'){
    document.getElementById('medIntervalo').value=med.intervaloDias||'';
    recDosisModo = med.dosisModo || 'fija';
    if(recDosisModo==='fija'){
      document.getElementById('medDosisRec').value=med.dosisRec||'';
    } else {
      vecesRecurrente = (med.dosisPorCiclo||[{dosis:''}]).map(v=>({dosis:v.dosis}));
      renderVecesRecurrente();
    }
    setRecDosisModo(recDosisModo);
  }
  document.getElementById('btnCancelarEdicionMed').style.display='';
  actualizarCalculos();
  document.getElementById('medFormTitle').scrollIntoView({behavior:'smooth', block:'start'});
}
async function toggleActivoMed(id){
  const med = meds.find(m=>m.id===id);
  if(!med) return;
  med.activo = !med.activo;
  await saveMed(med);
  await loadMeds();
  renderMedsList();
}
async function eliminarMed(id){
  await deleteMed(id);
  await loadMeds();
  renderMedsList();
  toast('Medicación eliminada');
}
let inactivasAbiertas = false;

function estaFinalizada(med, hoy){
  if(med.tipo==='recurrente') return false;
  const fin = fechaFinMed(med);
  return !!(fin && hoy > fin);
}

function medCardHtml(med, hoy){
  let infoFin='';
  const finalizada = estaFinalizada(med, hoy);
  if(med.tipo==='recurrente'){
    const prox = proximaTomaRecurrente(med, hoy);
    infoFin = 'Próxima toma: <b>'+fmtHuman(prox)+'</b> · se repite cada '+med.intervaloDias+' días';
    if(med.dosisModo==='variable') infoFin += ' · dosis varía según la vez';
  } else {
    const fin = fechaFinMed(med);
    const diasRest = diffDays(hoy, fin);
    const diaInfo = diaXdeY(med, hoy);
    const diaTxt = diaInfo ? ' · hoy es el día '+diaInfo.actual+' de '+diaInfo.total : '';
    infoFin = diasRest>=0 ? 'Hasta el <b>'+fmtHuman(fin)+'</b> · quedan '+diasRest+' día'+(diasRest===1?'':'s')+diaTxt : 'Finalizó el '+fmtHuman(fin);
  }
  const tipoLabel = med.tipo==='fijo'?'Fija':med.tipo==='variable'?'Variable':'Recurrente';
  const badgeEstado = med.activo===false ? '<span class="badge inactivo">Inactiva</span>' : (finalizada ? '<span class="badge finalizada">Finalizada</span>' : '');
  return '<div style="display:flex; justify-content:space-between; align-items:flex-start;"><div><h3>'+escapeHtml(med.nombre)+'</h3>'+
    '<span class="badge '+med.tipo+'">'+tipoLabel+'</span> '+badgeEstado+'</div></div>'+
    '<p class="muted" style="margin:8px 0 2px;">Desde el '+fmtHuman(med.fechaInicio)+(med.formaIngesta?' · '+escapeHtml(med.formaIngesta):'')+'</p>'+
    '<p class="muted" style="margin:2px 0 10px;">'+infoFin+'</p>'+
    (med.horarios && med.horarios.length ? '<p class="muted" style="margin:0 0 10px;">🕒 Horarios: '+med.horarios.slice().sort().map(fmtHora).join(', ')+'</p>' : '')+
    (med.notas ? '<p class="muted" style="margin:0 0 10px;">📝 '+escapeHtml(med.notas)+'</p>' : '')+
    '<div style="display:flex; gap:14px;">'+
    '<button class="ghost-small" data-edit="'+med.id+'" style="color:var(--pine);">Editar</button>'+
    '<button class="ghost-small" data-toggle="'+med.id+'" style="color:var(--ink-soft);">'+(med.activo===false?'Reactivar':'Marcar inactiva')+'</button>'+
    '<button class="ghost-small" data-del="'+med.id+'">Eliminar</button></div>';
}

function wireMedCardButtons(container){
  container.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editarMed(b.dataset.edit)));
  container.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',()=>toggleActivoMed(b.dataset.toggle)));
  container.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ if(confirm('¿Eliminar esta medicación del registro?')) eliminarMed(b.dataset.del); }));
}

function renderMedsList(){
  const wrap = document.getElementById('medsListWrap');
  const hoy = todayStr();
  const activas = meds.filter(m=>m.activo!==false && !estaFinalizada(m, hoy));
  const inactivas = meds.filter(m=>m.activo===false || estaFinalizada(m, hoy));

  wrap.innerHTML='';
  if(activas.length===0){
    wrap.innerHTML = meds.length===0
      ? '<div class="empty-state"><span class="big">💊</span>Todavía no cargaste ninguna medicación.</div>'
      : '<div class="empty-state"><span class="big">💊</span>No hay medicaciones activas ahora mismo.</div>';
  } else {
    activas.forEach(med=>{
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = medCardHtml(med, hoy);
      wrap.appendChild(card);
    });
  }
  wireMedCardButtons(wrap);

  const inactivasWrap = document.getElementById('medsInactivasWrap');
  const inactivasList = document.getElementById('medsInactivasList');
  const toggleBtn = document.getElementById('btnToggleInactivas');
  if(inactivas.length===0){
    inactivasWrap.style.display = 'none';
  } else {
    inactivasWrap.style.display = '';
    document.getElementById('inactivasToggleTexto').textContent = 'Medicaciones inactivas ('+inactivas.length+')';
    toggleBtn.classList.toggle('open', inactivasAbiertas);
    inactivasList.style.display = inactivasAbiertas ? '' : 'none';
    inactivasList.innerHTML = '';
    inactivas.forEach(med=>{
      const card = document.createElement('div');
      card.className='card';
      card.innerHTML = medCardHtml(med, hoy);
      inactivasList.appendChild(card);
    });
    wireMedCardButtons(inactivasList);
  }
}
document.getElementById('btnToggleInactivas').addEventListener('click', ()=>{
  inactivasAbiertas = !inactivasAbiertas;
  renderMedsList();
});

/* ==================== vista Historial ==================== */
async function renderHistorial(){
  const wrap = document.getElementById('histList');
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  if(!activePetId){ wrap.innerHTML=''; return; }
  const docs = await safeListCol(logsCol(activePetId));
  docs.sort((a,b)=> b.id.localeCompare(a.id));
  if(docs.length===0){ wrap.innerHTML='<div class="empty-state"><span class="big">📖</span>Todavía no hay registros guardados.</div>'; return; }
  wrap.innerHTML='';
  docs.forEach(log=>{
    const item = document.createElement('div');
    item.className='hist-item';
    const resumen = log.sintomas ? log.sintomas.slice(0,60)+(log.sintomas.length>60?'…':'') : 'Sin novedades registradas';
    item.innerHTML = '<div><div class="d">'+fmtHuman(log.id)+'</div><div class="s">'+escapeHtml(resumen)+'</div></div>'+
      '<div class="dot-status '+(log.completado?'ok':'miss')+'"></div>';
    item.addEventListener('click', ()=>{ selectedDate=log.id; switchView('hoy'); });
    wrap.appendChild(item);
  });
}
document.getElementById('histFechaPicker').addEventListener('change', (e)=>{
  if(e.target.value){ selectedDate=e.target.value; switchView('hoy'); }
});

/* ==================== documentos (recetas / órdenes) ==================== */
let docArchivos = [];

function compressImage(file, maxDim, maxChars){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w>h && w>maxDim){ h = Math.round(h*maxDim/w); w = maxDim; }
        else if(h>=w && h>maxDim){ w = Math.round(w*maxDim/h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while(dataUrl.length > maxChars && quality > 0.3){
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function readFileAsDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function procesarArchivoDoc(file){
  if(file.type === 'application/pdf'){
    const dataUrl = await readFileAsDataUrl(file);
    if(dataUrl.length > 900000){
      toast('El PDF "'+file.name+'" es muy pesado, no se agregó');
      return null;
    }
    return {tipo:'pdf', nombre:file.name, data:dataUrl};
  } else if(file.type.startsWith('image/')){
    const dataUrl = await compressImage(file, 1600, 500000);
    return {tipo:'image', nombre:file.name, data:dataUrl};
  }
  toast('Tipo de archivo no soportado: '+file.name);
  return null;
}

function renderDocPreview(){
  const wrap = document.getElementById('docPreviewWrap');
  const list = document.getElementById('docPreviewList');
  if(docArchivos.length===0){ wrap.style.display='none'; list.innerHTML=''; return; }
  wrap.style.display = '';
  list.innerHTML = docArchivos.map((a,idx)=>{
    if(a.tipo==='pdf'){
      return '<div class="doc-attach-pdf"><span>📄</span><span class="doc-attach-name">'+escapeHtml(a.nombre)+'</span><button type="button" class="doc-attach-remove" data-remove="'+idx+'">✕</button></div>';
    }
    return '<div class="doc-attach-img"><img src="'+a.data+'"><button type="button" class="doc-attach-remove" data-remove="'+idx+'">✕</button></div>';
  }).join('');
  list.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', ()=>{ docArchivos.splice(+b.dataset.remove,1); renderDocPreview(); });
  });
}

document.getElementById('docArchivo').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  if(files.length===0) return;
  for(const file of files){
    const totalActual = docArchivos.reduce((sum,a)=>sum+a.data.length,0);
    if(totalActual > 950000){
      toast('Ya alcanzaste el límite de tamaño para este documento');
      break;
    }
    toast('Procesando '+file.name+'...');
    try{
      const item = await procesarArchivoDoc(file);
      if(item) docArchivos.push(item);
    }catch(err){
      console.error(err);
      toast('No se pudo procesar '+file.name);
    }
  }
  renderDocPreview();
  e.target.value = '';
});

function resetDocForm(){
  editingDocId = null;
  docArchivos = [];
  document.getElementById('docFormTitle').textContent = 'Subir un documento';
  document.getElementById('docTitulo').value = '';
  document.getElementById('docFecha').value = todayStr();
  document.getElementById('docArchivo').value = '';
  renderDocPreview();
  document.getElementById('btnCancelarEdicionDoc').style.display = 'none';
}

async function guardarDocumento(){
  const titulo = document.getElementById('docTitulo').value.trim();
  const fecha = document.getElementById('docFecha').value || todayStr();
  if(!titulo){ toast('Poné un título'); return; }
  if(docArchivos.length===0){ toast('Elegí al menos un archivo'); return; }

  const data = {titulo, fecha, archivos: docArchivos};
  if(editingDocId){
    await safeSetDoc(docsCol(activePetId).doc(editingDocId), data);
    toast('Documento actualizado');
  } else {
    await docsCol(activePetId).add(data);
    toast('Documento guardado');
  }
  resetDocForm();
  renderDocumentos();
}

function editarDocumento(doc){
  editingDocId = doc.id;
  docArchivos = (doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : [])).slice();
  document.getElementById('docFormTitle').textContent = 'Editar documento';
  document.getElementById('docTitulo').value = doc.titulo;
  document.getElementById('docFecha').value = doc.fecha;
  document.getElementById('docArchivo').value = '';
  renderDocPreview();
  document.getElementById('btnCancelarEdicionDoc').style.display = '';
  document.getElementById('docFormTitle').scrollIntoView({behavior:'smooth', block:'start'});
}

async function eliminarDocumento(id){
  if(!confirm('¿Eliminar este documento?')) return;
  await safeDeleteDoc(docsCol(activePetId).doc(id));
  renderDocumentos();
  toast('Documento eliminado');
}

function abrirDocumento(doc){
  const archivos = doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : []);
  const w = window.open();
  if(!w) return;
  let html = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escapeHtml(doc.titulo)+'</title></head>'+
    '<body style="margin:0; background:#22302A; font-family:sans-serif;">'+
    '<h3 style="color:#fff; padding:14px; margin:0;">'+escapeHtml(doc.titulo)+' · '+fmtHuman(doc.fecha)+'</h3>';
  archivos.forEach(a=>{
    if(a.tipo==='pdf'){
      html += '<div style="padding:6px 14px;"><a href="'+a.data+'" download="'+escapeHtml(a.nombre)+'" style="color:#C9D3C2;">📄 Abrir / descargar '+escapeHtml(a.nombre)+'</a></div>'+
        '<embed src="'+a.data+'" type="application/pdf" style="width:100%; height:80vh; border:none; margin-bottom:14px;">';
    } else {
      html += '<img src="'+a.data+'" style="width:100%; display:block; margin-bottom:10px;">';
    }
  });
  html += '</body></html>';
  w.document.write(html);
}

async function renderDocumentos(){
  const wrap = document.getElementById('docsListWrap');
  if(!activePetId){ wrap.innerHTML=''; return; }
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  const docs = await safeListCol(docsCol(activePetId));
  docs.sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||''));
  if(docs.length===0){
    wrap.innerHTML = '<div class="empty-state"><span class="big">📄</span>Todavía no subiste ningún documento.</div>';
    return;
  }
  wrap.innerHTML = '';
  docs.forEach(doc=>{
    const archivos = doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : []);
    const primero = archivos[0];
    const thumbHtml = (primero && primero.tipo!=='pdf') ? '<img src="'+primero.data+'">' : '<div class="doc-thumb-pdf">📄</div>';
    const badge = archivos.length>1 ? '<span class="doc-thumb-badge">+'+(archivos.length-1)+'</span>' : '';
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.innerHTML =
      '<div class="doc-thumb-wrap" data-open="'+doc.id+'">'+thumbHtml+badge+'</div>'+
      '<div class="doc-info">'+
        '<b>'+escapeHtml(doc.titulo)+'</b>'+
        '<p class="muted" style="margin:2px 0 8px;">'+fmtHuman(doc.fecha)+(archivos.length>1?' · '+archivos.length+' archivos':'')+'</p>'+
        '<div style="display:flex; gap:14px;">'+
          '<button class="ghost-small" data-edit="'+doc.id+'" style="color:var(--pine);">Editar</button>'+
          '<button class="ghost-small" data-del="'+doc.id+'">Eliminar</button>'+
        '</div>'+
      '</div>';
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('[data-open]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const doc = docs.find(d=>d.id===el.dataset.open);
      if(doc) abrirDocumento(doc);
    });
  });
  wrap.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const doc = docs.find(d=>d.id===b.dataset.edit);
      if(doc) editarDocumento(doc);
    });
  });
  wrap.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', ()=>eliminarDocumento(b.dataset.del));
  });
}
document.getElementById('btnGuardarDoc').addEventListener('click', guardarDocumento);
document.getElementById('btnCancelarEdicionDoc').addEventListener('click', resetDocForm);



/* ==================== ajustes: mascotas ==================== */
function renderPetsList(){
  const wrap = document.getElementById('petsList');
  wrap.innerHTML='';
  pets.forEach(p=>{
    const row = document.createElement('div');
    row.className='pet-row';
    const esActiva = p.id===activePetId;
    row.innerHTML = '<input type="text" value="'+escapeHtml(p.nombre)+'" data-id="'+p.id+'">'+
      '<button type="button" class="tag-activa" data-select="'+p.id+'" style="background:'+(esActiva?'var(--pine)':'var(--paper-2)')+'; color:'+(esActiva?'var(--white)':'var(--ink-soft)')+';">'+(esActiva?'Activa':'Elegir')+'</button>'+
      (pets.length>1 ? '<button type="button" class="icon-btn" data-del="'+p.id+'">✕</button>' : '');
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input[data-id]').forEach(inp=>inp.addEventListener('blur', ()=>renombrarMascota(inp.dataset.id, inp.value.trim())));
  wrap.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click', ()=>setActivePet(b.dataset.select)));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>eliminarMascota(b.dataset.del)));
}
document.getElementById('btnAgregarMascota').addEventListener('click', agregarMascota);

/* ==================== ajustes: compartir ==================== */
async function renderCompartir(){
  const h = await safeGetDoc(householdRef());
  if(!h) return;
  document.getElementById('householdIdText').textContent = householdId;
  document.getElementById('ownerOnlyShare').style.display = isOwner ? '' : 'none';
  document.getElementById('ownerInfo').textContent = isOwner
    ? 'Sos el dueño de este hogar. Podés autorizar otros emails de Google para que vean y editen esta misma información.'
    : 'Este hogar es compartido por '+(h.ownerEmail||'otro usuario')+'.';
  const emailsWrap = document.getElementById('emailsList');
  const emails = h.allowedEmails || [];
  emailsWrap.innerHTML = emails.map(em=>{
    const puedeBorrar = isOwner && em !== h.ownerEmail;
    return '<div class="email-row"><span>'+escapeHtml(em)+(em===h.ownerEmail?' (dueño)':'')+'</span>'+
      (puedeBorrar ? '<button class="ghost-small" data-rmemail="'+escapeHtml(em)+'">Quitar</button>' : '')+'</div>';
  }).join('');
  emailsWrap.querySelectorAll('[data-rmemail]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const em = b.dataset.rmemail;
      await householdRef().update({allowedEmails: firebase.firestore.FieldValue.arrayRemove(em)});
      renderCompartir();
    });
  });
}
document.getElementById('btnCopyId').addEventListener('click', ()=>{
  navigator.clipboard.writeText(householdId).then(()=>toast('Código copiado')).catch(()=>toast('No se pudo copiar'));
});
document.getElementById('btnAgregarEmail').addEventListener('click', async ()=>{
  const input = document.getElementById('inputNuevoEmail');
  const email = input.value.trim().toLowerCase();
  if(!email || !email.includes('@')){ toast('Poné un email válido'); return; }
  await householdRef().update({allowedEmails: firebase.firestore.FieldValue.arrayUnion(email)});
  input.value='';
  toast('Email autorizado');
  renderCompartir();
});

/* ==================== consultas para el vet ==================== */
function consultasCol(petId){ return petsCol().doc(petId).collection('consultas'); }

document.getElementById('btnAgregarVet').addEventListener('click', async ()=>{
  const txt = document.getElementById('vetTexto').value.trim();
  if(!txt){ toast('Escribí algo primero'); return; }
  await consultasCol(activePetId).add({texto:txt, resuelto:false, ts:Date.now()});
  document.getElementById('vetTexto').value = '';
  renderVet();
});
async function toggleConsulta(id, val){
  await safeSetDoc(consultasCol(activePetId).doc(id), {resuelto:val});
  renderVet();
}
async function eliminarConsulta(id){
  if(!confirm('¿Eliminar este ítem?')) return;
  await safeDeleteDoc(consultasCol(activePetId).doc(id));
  renderVet();
}
async function renderVet(){
  const wrap = document.getElementById('vetListWrap');
  if(!activePetId){ wrap.innerHTML=''; return; }
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  const items = await safeListCol(consultasCol(activePetId));
  items.sort((a,b)=> (a.resuelto===b.resuelto) ? ((a.ts||0)-(b.ts||0)) : (a.resuelto?1:-1));
  if(items.length===0){
    wrap.innerHTML = '<div class="empty-state"><span class="big">🩺</span>Todavía no agregaste nada para preguntarle al vet.</div>';
    return;
  }
  wrap.innerHTML = '';
  items.forEach(it=>{
    const row = document.createElement('div');
    row.className = 'vet-item';
    row.innerHTML = '<input type="checkbox" data-id="'+it.id+'" '+(it.resuelto?'checked':'')+'>'+
      '<span style="'+(it.resuelto?'text-decoration:line-through; color:var(--ink-soft);':'')+'">'+escapeHtml(it.texto)+'</span>'+
      '<button class="icon-btn" data-del="'+it.id+'">✕</button>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(chk=>{
    chk.addEventListener('change', ()=>toggleConsulta(chk.dataset.id, chk.checked));
  });
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>eliminarConsulta(b.dataset.del)));
}

/* ==================== ajustes: formato y calendario ==================== */
function getCalHora(){
  return localStorage_safe_get('calHora-'+currentUser.uid) || '21:00';
}
async function renderAjustes(){
  renderPetsList();
  await renderCompartir();
  document.querySelectorAll('#prefFechaSeg button').forEach(b=>b.classList.toggle('active', b.dataset.val===prefs.fecha));
  document.querySelectorAll('#prefHoraSeg button').forEach(b=>b.classList.toggle('active', b.dataset.val===prefs.hora));
  document.getElementById('calRecordHora').value = getCalHora();
  document.getElementById('cuentaInfo').textContent = 'Conectado como '+currentUser.email;
  updateCalendarLinks();
}
document.querySelectorAll('#prefFechaSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    prefs.fecha = b.dataset.val;
    savePrefs();
    render();
  });
});
document.querySelectorAll('#prefHoraSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    prefs.hora = b.dataset.val;
    savePrefs();
    render();
  });
});
document.getElementById('calRecordHora').addEventListener('input', ()=>{
  localStorage_safe_set('calHora-'+currentUser.uid, document.getElementById('calRecordHora').value || '21:00');
  updateCalendarLinks();
});

function buildDateTimeStr(dateStr, timeStr){ return dateStr.replace(/-/g,'')+'T'+timeStr.replace(':','')+'00'; }
function nowUTCStr(){
  const d=new Date();
  return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())+'Z';
}
function updateCalendarLinks(){
  const gcalEl = document.getElementById('linkGCal');
  const icsEl = document.getElementById('linkIcs');
  if(!gcalEl || !icsEl) return;
  const nombreTexto = pets.length>1 ? 'tus mascotas' : (getActivePet() ? getActivePet().nombre : 'tu mascota');
  const horaInput = document.getElementById('calRecordHora').value || '21:00';
  const hoy = todayStr();
  const startStr = buildDateTimeStr(hoy, horaInput);
  const [hh,mm] = horaInput.split(':').map(Number);
  let endH=hh, endM=mm+15;
  if(endM>=60){ endM-=60; endH+=1; if(endH>=24) endH-=24; }
  const endStr = buildDateTimeStr(hoy, pad(endH)+':'+pad(endM));
  const text = encodeURIComponent('Completar diario de '+nombreTexto);
  const details = encodeURIComponent('Recordatorio para cargar el registro del día en el Diario de salud de '+nombreTexto+'.');
  gcalEl.href = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+text+'&dates='+startStr+'/'+endStr+'&recur=RRULE:FREQ=DAILY&details='+details;
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DiarioDeSalud//ES','BEGIN:VEVENT','UID:diario-'+Date.now()+'@local',
    'DTSTAMP:'+nowUTCStr(),'DTSTART:'+startStr,'DTEND:'+endStr,'RRULE:FREQ=DAILY','SUMMARY:Completar diario de '+nombreTexto,
    'DESCRIPTION:Recordatorio diario','BEGIN:VALARM','TRIGGER:-PT5M','ACTION:DISPLAY','DESCRIPTION:Recordatorio','END:VALARM','END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  icsEl.href = 'data:text/calendar;charset=utf-8,'+encodeURIComponent(ics);
}

/* ==================== navegación ==================== */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  render();
}
document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click', ()=>switchView(b.dataset.view)));

/* ==================== render general ==================== */
async function render(){
  const pet = getActivePet();
  document.getElementById('dogName').textContent = pet ? pet.nombre : 'Sin mascota';
  renderPetPicker();
  await renderPastillero();
  const activeView = document.querySelector('.view.active').id;
  if(activeView==='view-hoy') await renderHoy();
  if(activeView==='view-meds') renderMedsList();
  if(activeView==='view-historial') await renderHistorial();
  if(activeView==='view-documentos') await renderDocumentos();
  if(activeView==='view-vet') await renderVet();
  if(activeView==='view-ajustes') await renderAjustes();
  const totalMeds = meds.filter(m=>m.activo!==false).length;
  document.getElementById('topSub').textContent = totalMeds>0 ? totalMeds+' medicación'+(totalMeds===1?'':'es')+' activa'+(totalMeds===1?'':'s') : 'Sin medicación activa';
}

/* ==================== eventos formulario medicación ==================== */
document.querySelectorAll('#medTipoSeg button').forEach(b=>b.addEventListener('click', ()=>setMedTipo(b.dataset.tipo)));
document.querySelectorAll('#recDosisModoSeg button').forEach(b=>b.addEventListener('click', ()=>setRecDosisModo(b.dataset.modo)));
document.getElementById('medFechaInicio').addEventListener('change', ()=>actualizarCalculos());
document.getElementById('medDuracion').addEventListener('input', ()=>actualizarCalculos('dur'));
document.getElementById('medFechaFinFijo').addEventListener('input', ()=>actualizarCalculos('fin'));
document.getElementById('medIntervalo').addEventListener('input', ()=>actualizarCalculos());
document.getElementById('btnAgregarDiaVar').addEventListener('click', ()=>{ diasVariable.push({dia:diasVariable.length+1, dosis:''}); renderDiasVariable(); actualizarCalculos(); });
document.getElementById('btnAgregarHorario').addEventListener('click', ()=>{ horariosForm.push('08:00'); renderHorariosForm(); });
document.getElementById('btnAgregarVezRec').addEventListener('click', ()=>{ vecesRecurrente.push({dosis:''}); renderVecesRecurrente(); actualizarCalculos(); });
document.getElementById('btnGuardarMed').addEventListener('click', guardarMedForm);
document.getElementById('btnCancelarEdicionMed').addEventListener('click', resetMedForm);
document.getElementById('btnGuardarHoy').addEventListener('click', guardarHoy);
