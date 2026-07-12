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
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return dias[d.getDay()]+' '+d.getDate()+' '+meses[d.getMonth()];
}
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
async function renderPastillero(){
  const cont = document.getElementById('pastillero');
  cont.innerHTML = '';
  const hoy = todayStr();
  const diaSemana = (parseDate(hoy).getDay()+6)%7;
  const lunes = addDays(hoy, -diaSemana);
  const letras = ['L','M','M','J','V','S','D'];
  for(let i=0;i<7;i++){
    const ds = addDays(lunes, i);
    const btn = document.createElement('div');
    btn.className = 'pill-day';
    if(ds===hoy) btn.classList.add('today');
    if(ds===selectedDate) btn.classList.add('selected');
    if(ds>hoy) btn.classList.add('future');
    if(ds<=hoy){
      const log = await loadLog(ds);
      if(log && log.completado) btn.classList.add('done');
      else if(ds<hoy) btn.classList.add('missed');
    }
    btn.innerHTML = '<span class="l">'+letras[i]+'</span><span class="n">'+parseDate(ds).getDate()+'</span><span class="dot"></span>';
    if(ds<=hoy) btn.addEventListener('click', ()=>{ selectedDate=ds; render(); });
    cont.appendChild(btn);
  }
}

/* ==================== vista Hoy ==================== */
async function renderHoy(){
  const titulo = document.getElementById('hoyTitulo');
  const esHoy = selectedDate === todayStr();
  titulo.textContent = esHoy ? 'Hoy · '+fmtHuman(selectedDate) : fmtHuman(selectedDate);

  const bannerWrap = document.getElementById('hoyBanner');
  bannerWrap.innerHTML = '';
  if(esHoy){
    const sett = await getSettings();
    const [h,m] = (sett.hora||'21:00').split(':').map(Number);
    const now = new Date();
    const pasoLaHora = now.getHours()>h || (now.getHours()===h && now.getMinutes()>=m);
    const logHoy = await loadLog(todayStr());
    if(pasoLaHora && (!logHoy || !logHoy.completado)){
      bannerWrap.innerHTML = '<div class="banner rust"><span>🔔</span><div><b>No olvides registrar el día de hoy</b>Ya pasaron las '+sett.hora+'. Completá aunque sea "todo normal".</div></div>';
    }
  }

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
      const horarioTxt = horario!=='_default' ? escapeHtml(horario)+' · ' : '';
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
function renderMedsList(){
  const wrap = document.getElementById('medsListWrap');
  wrap.innerHTML='';
  if(meds.length===0){ wrap.innerHTML='<div class="empty-state"><span class="big">💊</span>Todavía no cargaste ninguna medicación.</div>'; return; }
  const hoy = todayStr();
  meds.forEach(med=>{
    const card = document.createElement('div');
    card.className='card';
    let infoFin='';
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
    card.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;"><div><h3>'+escapeHtml(med.nombre)+'</h3>'+
      '<span class="badge '+med.tipo+'">'+tipoLabel+'</span> '+(med.activo===false?'<span class="badge inactivo">Inactiva</span>':'')+'</div></div>'+
      '<p class="muted" style="margin:8px 0 2px;">Desde el '+fmtHuman(med.fechaInicio)+(med.formaIngesta?' · '+escapeHtml(med.formaIngesta):'')+'</p>'+
      '<p class="muted" style="margin:2px 0 10px;">'+infoFin+'</p>'+
      (med.horarios && med.horarios.length ? '<p class="muted" style="margin:0 0 10px;">🕒 Horarios: '+med.horarios.slice().sort().join(', ')+'</p>' : '')+
      (med.notas ? '<p class="muted" style="margin:0 0 10px;">📝 '+escapeHtml(med.notas)+'</p>' : '')+
      '<div style="display:flex; gap:14px;">'+
      '<button class="ghost-small" data-edit="'+med.id+'" style="color:var(--pine);">Editar</button>'+
      '<button class="ghost-small" data-toggle="'+med.id+'" style="color:var(--ink-soft);">'+(med.activo===false?'Reactivar':'Marcar inactiva')+'</button>'+
      '<button class="ghost-small" data-del="'+med.id+'">Eliminar</button></div>';
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editarMed(b.dataset.edit)));
  wrap.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',()=>toggleActivoMed(b.dataset.toggle)));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ if(confirm('¿Eliminar esta medicación del registro?')) eliminarMed(b.dataset.del); }));
}

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

/* ==================== ajustes: hora, notif, calendario ==================== */
async function getSettings(){
  const raw = localStorage_safe_get('settings-'+currentUser.uid);
  if(raw){ try{ return JSON.parse(raw); }catch(e){} }
  return {hora:'21:00'};
}
async function renderAjustes(){
  renderPetsList();
  await renderCompartir();
  const sett = await getSettings();
  document.getElementById('settRecordHora').value = sett.hora || '21:00';
  if('Notification' in window){
    const perm = Notification.permission;
    document.getElementById('notifStatus').textContent =
      perm==='granted' ? 'Notificaciones activadas en este navegador.' :
      perm==='denied' ? 'Bloqueaste las notificaciones para este sitio.' : 'Todavía no activaste las notificaciones.';
  } else {
    document.getElementById('notifStatus').textContent = 'Este navegador no soporta notificaciones.';
  }
  document.getElementById('cuentaInfo').textContent = 'Conectado como '+currentUser.email;
  updateCalendarLinks();
}
document.getElementById('btnGuardarAjustes').addEventListener('click', ()=>{
  const hora = document.getElementById('settRecordHora').value || '21:00';
  localStorage_safe_set('settings-'+currentUser.uid, JSON.stringify({hora}));
  toast('Ajustes guardados');
  render();
});
document.getElementById('settRecordHora').addEventListener('input', updateCalendarLinks);
document.getElementById('btnActivarNotif').addEventListener('click', async ()=>{
  if(!('Notification' in window)){ toast('No soportado en este navegador'); return; }
  const perm = await Notification.requestPermission();
  if(perm==='granted') toast('¡Notificaciones activadas!');
  renderAjustes();
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
  const horaInput = document.getElementById('settRecordHora').value || '21:00';
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

let ultimoAvisoDia = null;
setInterval(async ()=>{
  if(!currentUser || !('Notification' in window) || Notification.permission!=='granted') return;
  const sett = await getSettings();
  const [h,m] = (sett.hora||'21:00').split(':').map(Number);
  const now = new Date();
  if(now.getHours()===h && now.getMinutes()===m){
    const hoy = todayStr();
    if(ultimoAvisoDia===hoy) return;
    const log = await loadLog(hoy);
    if(!log || !log.completado){
      const nombreTexto = getActivePet() ? getActivePet().nombre : 'tu mascota';
      new Notification('Diario de '+nombreTexto, {body:'No olvides registrar cómo estuvo hoy.'});
      ultimoAvisoDia = hoy;
    }
  }
}, 30000);

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
