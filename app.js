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
  try{ await ref.set(data, {merge:true}); return true; }
  catch(e){
    console.error(e);
    toast('Error guardando'+(e && e.message ? ': '+e.message : ' (revisá tu conexión)'));
    return false;
  }
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
let recUnidadIntervalo = 'dias';
let recFinModo = 'nunca';
let medsSubView = 'meds';
let editingVacunaId = null;
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
    const params = new URLSearchParams(location.search);
    const codeFromLink = params.get('household');
    if(codeFromLink){
      document.getElementById('inputJoinCode').value = codeFromLink;
    }
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
  resetVacunaForm();
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
  try{
    const ref = await petsCol().add({nombre:'Nueva mascota'});
    await loadPets();
    await setActivePet(ref.id);
    renderPetsList();
  }catch(err){
    console.error(err);
    toast('No se pudo agregar la mascota (revisá tu conexión)');
  }
}
async function renombrarMascota(id, nombre){
  if(!nombre){ toast('El nombre no puede quedar vacío'); renderPetsList(); return; }
  await safeSetDoc(petsCol().doc(id), {nombre});
  await loadPets();
  toast('Nombre actualizado');
  render();
}
async function eliminarMascota(id){
  if(pets.length<=1){ toast('Necesitás al menos una mascota'); return; }
  const p = pets.find(x=>x.id===id);
  const nombre = p ? p.nombre : 'esta mascota';

  if(!confirm('¿Eliminar a '+nombre+'? Se van a borrar TODOS sus datos: medicaciones, historial, documentos y vacunas.')) return;
  if(!confirm('Esto no se puede deshacer. Una vez eliminado no hay forma de recuperar la información de '+nombre+'. ¿Continuar?')) return;
  const confirmacion = prompt('Para confirmar, escribí el nombre exacto de la mascota ("'+nombre+'"):');
  if(confirmacion===null) return;
  if(confirmacion.trim().toLowerCase() !== nombre.trim().toLowerCase()){
    toast('El nombre no coincide, no se eliminó nada');
    return;
  }

  toast('Eliminando...');
  const colecciones = [medsCol(id), logsCol(id), docsCol(id), vacunasCol(id), consultasCol(id)];
  for(const col of colecciones){
    const docs = await safeListCol(col);
    for(const d of docs) await safeDeleteDoc(col.doc(d.id));
  }
  await safeDeleteDoc(petsCol().doc(id));
  await loadPets();
  if(activePetId===id) await setActivePet(pets[0].id);
  else { renderPetsList(); render(); }
  toast(nombre+' fue eliminada');
}

/* ==================== medicaciones: cálculo ==================== */
function fechaFinMed(med){
  if(med.tipo==='fijo') return addDays(med.fechaInicio, (med.duracionDias||1)-1);
  if(med.tipo==='variable') return addDays(med.fechaInicio, (med.dosisPorDia||[]).length-1);
  return null;
}
function addMonths(dateStr, n){
  const d = parseDate(dateStr);
  const firstOfTarget = new Date(d.getFullYear(), d.getMonth()+n, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth()+1, 0).getDate();
  const day = Math.min(d.getDate(), lastDay);
  return toStr(new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), day));
}
function getIntervaloNum(med){ return med.intervalo!=null ? med.intervalo : (med.intervaloDias||1); }
function getUnidadIntervalo(med){ return med.unidadIntervalo || 'dias'; }
function fechaDeOcurrencia(med, k){
  const n = getIntervaloNum(med);
  return getUnidadIntervalo(med)==='meses' ? addMonths(med.fechaInicio, k*n) : addDays(med.fechaInicio, k*n);
}
function ocurrenciaDentroDeLimite(med, k){
  if(med.finModo==='veces') return k < (med.finVeces||1);
  if(med.finModo==='fecha' && med.finFecha) return fechaDeOcurrencia(med,k) <= med.finFecha;
  return true;
}
function ocurrenciaIndice(med, dateStr){
  if(dateStr < med.fechaInicio) return null;
  const n = getIntervaloNum(med);
  if(getUnidadIntervalo(med)==='meses'){
    const d0=parseDate(med.fechaInicio), d1=parseDate(dateStr);
    const totalMeses = (d1.getFullYear()-d0.getFullYear())*12 + (d1.getMonth()-d0.getMonth());
    if(totalMeses % n !== 0 || totalMeses<0) return null;
    const k = totalMeses/n;
    return addMonths(med.fechaInicio, k*n)===dateStr ? k : null;
  }
  const diff = diffDays(med.fechaInicio, dateStr);
  return (diff % n === 0) ? diff/n : null;
}
function dosisEnFecha(med, dateStr){
  const diff = diffDays(med.fechaInicio, dateStr);
  if(diff<0) return null;
  if(med.tipo==='fijo'){ return diff <= (med.duracionDias||1)-1 ? med.dosisFija : null; }
  if(med.tipo==='variable'){ const arr=med.dosisPorDia||[]; return diff<arr.length ? arr[diff].dosis : null; }
  if(med.tipo==='recurrente'){
    if(estaFinalizada(med, dateStr)) return null;
    const proxima = med.proximaFecha || med.fechaInicio;
    if(dateStr < proxima) return null;
    if(med.dosisModo==='variable'){
      const arr = med.dosisPorCiclo||[];
      if(arr.length===0) return null;
      const idx = Math.min(med.vecesDadas||0, arr.length-1);
      return arr[idx].dosis;
    }
    return med.dosisRec;
  }
  return null;
}
function vezDeRecurrente(med, dateStr){
  if(med.tipo!=='recurrente') return null;
  if(estaFinalizada(med, dateStr)) return null;
  const proxima = med.proximaFecha || med.fechaInicio;
  if(dateStr < proxima) return null;
  return (med.vecesDadas||0)+1;
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
  const n = getIntervaloNum(med);
  if(fromStr <= med.fechaInicio){
    return ocurrenciaDentroDeLimite(med,0) ? med.fechaInicio : null;
  }
  if(getUnidadIntervalo(med)==='meses'){
    const d0=parseDate(med.fechaInicio), d1=parseDate(fromStr);
    const totalMeses = (d1.getFullYear()-d0.getFullYear())*12 + (d1.getMonth()-d0.getMonth());
    const kBase = Math.floor(totalMeses/n);
    for(let k=Math.max(0,kBase-1); k<kBase+3; k++){
      const f = addMonths(med.fechaInicio, k*n);
      if(f >= fromStr) return ocurrenciaDentroDeLimite(med,k) ? f : null;
    }
    return null;
  }
  const diff = diffDays(med.fechaInicio, fromStr);
  const resto = diff % n;
  const diasHasta = resto===0 ? 0 : (n-resto);
  const k = (diff+diasHasta)/n;
  return ocurrenciaDentroDeLimite(med,k) ? addDays(fromStr, diasHasta) : null;
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
  const ok = await safeSetDoc(medsCol(activePetId).doc(id), data);
  return ok ? id : null;
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
  document.getElementById('pastilleroJump').value = selectedDate;
}

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
  const log = (await loadLog(selectedDate)) || {fecha:selectedDate, sintomas:'', apetito:'', animo:'', notas:'', medicacionesTomadas:{}, completado:false};

  const delDia = [];
  activos.forEach(m=>{
    const dosis = dosisEnFecha(m, selectedDate);
    if(dosis){
      horariosDe(m).forEach(h=>delDia.push({med:m, dosis, horario:h}));
    }
  });
  // tomas recurrentes ya registradas ese día aunque ya no figuren como pendientes
  activos.forEach(m=>{
    if(m.tipo!=='recurrente') return;
    if(delDia.some(x=>x.med.id===m.id)) return;
    const tomadas = log.medicacionesTomadas && log.medicacionesTomadas[m.id];
    if(!tomadas) return;
    const horarios = horariosDe(m);
    if(!horarios.some(h=>tomadas[h])) return;
    const dosisTxt = m.dosisRec || (m.dosisPorCiclo && m.dosisPorCiclo.length ? m.dosisPorCiclo[m.dosisPorCiclo.length-1].dosis : 'según correspondía');
    horarios.forEach(h=>delDia.push({med:m, dosis:dosisTxt, horario:h}));
  });
  delDia.sort((a,b)=>{
    const ta = a.horario==='_default' ? '' : a.horario;
    const tb = b.horario==='_default' ? '' : b.horario;
    return ta.localeCompare(tb) || a.med.nombre.localeCompare(b.med.nombre);
  });

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
      else {
        const vez = vezDeRecurrente(med, selectedDate);
        if(vez) diaTxt = ' · Vez '+vez;
        if(med.tipo==='recurrente' && !checked && selectedDate > (med.proximaFecha||med.fechaInicio)) diaTxt += ' · ⚠️ atrasada';
      }
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

function medDadoCompleto(tomadasObj, med){
  if(!tomadasObj) return false;
  return horariosDe(med).every(h=>!!tomadasObj[h]);
}
async function guardarHoy(){
  const prevLog = (await loadLog(selectedDate)) || {medicacionesTomadas:{}};
  const medsMarcados = {};
  document.querySelectorAll('#medsHoyList input[type=checkbox]').forEach(chk=>{
    const mid = chk.dataset.medid, hor = chk.dataset.horario;
    medsMarcados[mid] = medsMarcados[mid] || {};
    medsMarcados[mid][hor] = chk.checked;
  });

  for(const mid of Object.keys(medsMarcados)){
    const med = meds.find(m=>m.id===mid);
    if(!med || med.tipo!=='recurrente') continue;
    const dadoAhora = medDadoCompleto(medsMarcados[mid], med);
    const dadoAntes = medDadoCompleto(prevLog.medicacionesTomadas && prevLog.medicacionesTomadas[mid], med);
    const n = getIntervaloNum(med);
    if(dadoAhora && !dadoAntes){
      const nuevaProxima = getUnidadIntervalo(med)==='meses' ? addMonths(selectedDate, n) : addDays(selectedDate, n);
      const proximaAnterior = med.proximaFecha, vecesAnteriores = med.vecesDadas||0;
      med.proximaFecha = nuevaProxima;
      med.vecesDadas = vecesAnteriores+1;
      const ok = await safeSetDoc(medsCol(activePetId).doc(mid), {proximaFecha: med.proximaFecha, vecesDadas: med.vecesDadas});
      if(!ok){ med.proximaFecha = proximaAnterior; med.vecesDadas = vecesAnteriores; }
    } else if(!dadoAhora && dadoAntes){
      const esperada = getUnidadIntervalo(med)==='meses' ? addMonths(selectedDate, n) : addDays(selectedDate, n);
      if(med.proximaFecha===esperada && (med.vecesDadas||0)>0){
        const proximaAnterior = med.proximaFecha, vecesAnteriores = med.vecesDadas;
        med.proximaFecha = selectedDate;
        med.vecesDadas = vecesAnteriores-1;
        const ok = await safeSetDoc(medsCol(activePetId).doc(mid), {proximaFecha: med.proximaFecha, vecesDadas: med.vecesDadas});
        if(!ok){ med.proximaFecha = proximaAnterior; med.vecesDadas = vecesAnteriores; }
      } else {
        toast('Solo se puede deshacer la toma más reciente de "'+med.nombre+'"');
      }
    }
  }

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

/* ==================== lightbox de imagen (agrandar foto) ==================== */
function abrirLightbox(src){
  document.getElementById('imgLightboxImg').src = src;
  document.getElementById('imgLightboxOverlay').style.display = 'flex';
}
function cerrarLightbox(){
  document.getElementById('imgLightboxOverlay').style.display = 'none';
  document.getElementById('imgLightboxImg').src = '';
}
document.getElementById('btnCerrarLightbox').addEventListener('click', cerrarLightbox);
document.getElementById('imgLightboxOverlay').addEventListener('click', (e)=>{
  if(e.target.id==='imgLightboxOverlay') cerrarLightbox();
});

/* ==================== vista Medicación ==================== */
let medFotoActual = null;

function renderMedFotoPreview(){
  const wrap = document.getElementById('medFotoPreviewWrap');
  const img = document.getElementById('medFotoPreviewImg');
  if(!medFotoActual){ wrap.style.display='none'; img.src=''; return; }
  img.src = medFotoActual;
  wrap.style.display = '';
}
document.getElementById('medFoto').addEventListener('change', async (e)=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Elegí una imagen'); return; }
  toast('Procesando foto...');
  try{
    medFotoActual = await compressImage(file, 1000, 260000);
    renderMedFotoPreview();
  }catch(err){
    console.error(err);
    toast('No se pudo procesar la foto');
  }
});
document.getElementById('btnQuitarMedFoto').addEventListener('click', ()=>{
  medFotoActual = null;
  renderMedFotoPreview();
});

function resetMedForm(){
  editingMedId = null;
  medTipoActual = 'fijo';
  diasVariable = [{dia:1, dosis:''}];
  horariosForm = [];
  recDosisModo = 'fija';
  vecesRecurrente = [{dosis:''}];
  recUnidadIntervalo = 'dias';
  recFinModo = 'nunca';
  document.getElementById('medFormTitle').textContent='Agregar medicación';
  document.getElementById('medNombre').value='';
  document.getElementById('medForma').value='';
  document.getElementById('medFechaInicio').value=todayStr();
  document.getElementById('medDosisFija').value='';
  document.getElementById('medDuracion').value='';
  document.getElementById('medFechaFinFijo').value='';
  document.getElementById('medDosisRec').value='';
  document.getElementById('medIntervalo').value='';
  document.getElementById('medUnidadIntervalo').value='dias';
  document.getElementById('medFinVeces').value='';
  document.getElementById('medFinFecha').value='';
  document.getElementById('medNotas').value='';
  medFotoActual = null;
  renderMedFotoPreview();
  document.getElementById('btnCancelarEdicionMed').style.display='none';
  setMedTipo('fijo');
  setRecDosisModo('fija');
  setRecFinModo('nunca');
  renderDiasVariable();
  renderHorariosForm();
  renderVecesRecurrente();
  actualizarCalculos();
}
function setRecFinModo(modo){
  recFinModo = modo;
  document.querySelectorAll('#recFinModoSeg button').forEach(b=>b.classList.toggle('active', b.dataset.modo===modo));
  document.getElementById('recFinVecesWrap').style.display = modo==='veces' ? '' : 'none';
  document.getElementById('recFinFechaWrap').style.display = modo==='fecha' ? '' : 'none';
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
    document.getElementById('medMensualInfo').style.display = recUnidadIntervalo==='meses' ? '' : 'none';
    if(recUnidadIntervalo==='meses'){
      document.getElementById('medMensualInfo').textContent = 'Se repetirá el día '+parseDate(inicio).getDate()+' de cada '+(it>1?it+' meses':'mes')+' (según la fecha de inicio).';
    }
    if(it>0){
      const medTmp = {
        fechaInicio: inicio, intervalo: it, unidadIntervalo: recUnidadIntervalo,
        finModo: recFinModo,
        finVeces: +document.getElementById('medFinVeces').value || 1,
        finFecha: document.getElementById('medFinFecha').value || null
      };
      const prox = proximaTomaRecurrente(medTmp, todayStr());
      let dosisTxt = '';
      if(prox && recDosisModo==='variable' && vecesRecurrente.length){
        const k = ocurrenciaIndice(medTmp, prox);
        if(k!==null){
          const idx = Math.min(k, vecesRecurrente.length-1);
          if(vecesRecurrente[idx] && vecesRecurrente[idx].dosis) dosisTxt = ' · '+vecesRecurrente[idx].dosis+' (vez '+(k+1)+')';
        }
      }
      const unidadTxt = recUnidadIntervalo==='meses' ? (it===1?'mes':'meses') : (it===1?'día':'días');
      if(prox===null){
        el.textContent = 'Con esta configuración, no quedarían tomas futuras.';
      } else {
        el.textContent = 'Se repite cada '+it+' '+unidadTxt+'. Próxima toma: '+fmtHuman(prox)+dosisTxt+'.';
      }
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
  let med = { id: editingMedId, nombre, formaIngesta, fechaInicio, notas, tipo: medTipoActual, activo:true, horarios, foto: medFotoActual||null };

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
    if(!it || it<1){ toast('Indicá cada cuánto se repite'); return; }
    med.intervalo = it;
    med.unidadIntervalo = recUnidadIntervalo;
    med.finModo = recFinModo;
    if(recFinModo==='veces'){
      const nVeces = +document.getElementById('medFinVeces').value;
      if(!nVeces || nVeces<1){ toast('Indicá cuántas veces se repite'); return; }
      med.finVeces = nVeces;
    } else if(recFinModo==='fecha'){
      const finFecha = document.getElementById('medFinFecha').value;
      if(!finFecha){ toast('Indicá hasta qué fecha se repite'); return; }
      if(finFecha < fechaInicio){ toast('La fecha de fin no puede ser antes del inicio'); return; }
      med.finFecha = finFecha;
    }
    med.dosisModo = recDosisModo;
    if(recDosisModo==='fija'){
      const dosisRec = document.getElementById('medDosisRec').value.trim();
      if(!dosisRec){ toast('Indicá la dosis'); return; }
      med.dosisRec = dosisRec;
    } else {
      if(vecesRecurrente.some(v=>!v.dosis.trim())){ toast('Completá la dosis de cada vez'); return; }
      med.dosisPorCiclo = vecesRecurrente.map((v,i)=>({ciclo:i+1, dosis:v.dosis.trim()}));
    }
    if(!editingMedId){
      med.proximaFecha = fechaInicio;
      med.vecesDadas = 0;
    }
  }

  const id = await saveMed(med);
  if(!id) return;
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
  medFotoActual = med.foto || null;
  renderMedFotoPreview();
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
    document.getElementById('medIntervalo').value=getIntervaloNum(med);
    recUnidadIntervalo = getUnidadIntervalo(med);
    document.getElementById('medUnidadIntervalo').value = recUnidadIntervalo;
    recFinModo = med.finModo || 'nunca';
    document.getElementById('medFinVeces').value = med.finVeces || '';
    document.getElementById('medFinFecha').value = med.finFecha || '';
    setRecFinModo(recFinModo);
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
  if(med.tipo==='recurrente'){
    if(!med.finModo || med.finModo==='nunca') return false;
    if(med.finModo==='veces') return (med.vecesDadas||0) >= (med.finVeces||1);
    if(med.finModo==='fecha' && med.finFecha) return (med.proximaFecha||med.fechaInicio) > med.finFecha;
    return false;
  }
  const fin = fechaFinMed(med);
  return !!(fin && hoy > fin);
}

function medRRule(med){
  if(med.tipo==='recurrente'){
    let rule = getUnidadIntervalo(med)==='meses' ? ('FREQ=MONTHLY;INTERVAL='+getIntervaloNum(med)) : ('FREQ=DAILY;INTERVAL='+getIntervaloNum(med));
    if(med.finModo==='veces' && med.finVeces) rule += ';COUNT='+med.finVeces;
    else if(med.finModo==='fecha' && med.finFecha) rule += ';UNTIL='+med.finFecha.replace(/-/g,'')+'T235959Z';
    return rule;
  }
  const fin = fechaFinMed(med) || med.fechaInicio;
  return 'FREQ=DAILY;UNTIL='+fin.replace(/-/g,'')+'T235959Z';
}
function medCalendarUrls(med){
  const hora = (med.horarios && med.horarios[0]) ? med.horarios[0] : '09:00';
  const startStr = buildDateTimeStr(med.fechaInicio, hora);
  const [hh,mm] = hora.split(':').map(Number);
  let endH=hh, endM=mm+15;
  if(endM>=60){ endM-=60; endH+=1; if(endH>=24) endH-=24; }
  const endStr = buildDateTimeStr(med.fechaInicio, pad(endH)+':'+pad(endM));
  const dosisTxt = med.tipo==='fijo' ? (med.dosisFija||'') : (med.tipo==='recurrente' ? (med.dosisRec||'según corresponda') : 'según el día');
  const detalleTxt = (med.formaIngesta||'')+' '+dosisTxt+(med.notas?' · '+med.notas:'');
  const rrule = medRRule(med);
  const gcalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent('Medicación: '+med.nombre)+
    '&dates='+startStr+'/'+endStr+'&recur='+encodeURIComponent('RRULE:'+rrule)+'&details='+encodeURIComponent(detalleTxt);
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DiarioDeSalud//ES','BEGIN:VEVENT','UID:med-'+med.id+'@local',
    'DTSTAMP:'+nowUTCStr(),'DTSTART:'+startStr,'DTEND:'+endStr,'RRULE:'+rrule,'SUMMARY:Medicación: '+med.nombre,
    'DESCRIPTION:'+detalleTxt.replace(/[\r\n,]/g,' '),'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const icsUrl = 'data:text/calendar;charset=utf-8,'+encodeURIComponent(ics);
  return {gcalUrl, icsUrl};
}

function medCardHtml(med, hoy){
  let infoFin='';
  const finalizada = estaFinalizada(med, hoy);
  if(med.tipo==='recurrente'){
    const prox = finalizada ? null : (med.proximaFecha || med.fechaInicio);
    const unidadTxt = getUnidadIntervalo(med)==='meses' ? (getIntervaloNum(med)===1?'mes':'meses') : (getIntervaloNum(med)===1?'día':'días');
    if(prox===null){
      infoFin = 'Completó todas las tomas programadas.';
    } else if(prox < hoy){
      infoFin = '⚠️ Atrasada desde el <b>'+fmtHuman(prox)+'</b> · se repite cada '+getIntervaloNum(med)+' '+unidadTxt;
      if(med.dosisModo==='variable') infoFin += ' · dosis varía según la vez';
    } else {
      infoFin = 'Próxima toma: <b>'+fmtHuman(prox)+'</b> · se repite cada '+getIntervaloNum(med)+' '+unidadTxt;
      if(med.dosisModo==='variable') infoFin += ' · dosis varía según la vez';
    }
    if(med.finModo==='veces') infoFin += ' · '+(med.vecesDadas||0)+' de '+med.finVeces+' veces';
    else if(med.finModo==='fecha') infoFin += ' · hasta el '+fmtHuman(med.finFecha);
  } else {
    const fin = fechaFinMed(med);
    const diasRest = diffDays(hoy, fin);
    const diaInfo = diaXdeY(med, hoy);
    const diaTxt = diaInfo ? ' · hoy es el día '+diaInfo.actual+' de '+diaInfo.total : '';
    infoFin = diasRest>=0 ? 'Hasta el <b>'+fmtHuman(fin)+'</b> · quedan '+diasRest+' día'+(diasRest===1?'':'s')+diaTxt : 'Finalizó el '+fmtHuman(fin);
  }
  const tipoLabel = med.tipo==='fijo'?'Fija':med.tipo==='variable'?'Variable':'Recurrente';
  const badgeEstado = med.activo===false ? '<span class="badge inactivo">Inactiva</span>' : (finalizada ? '<span class="badge finalizada">Finalizada</span>' : '');
  const cal = medCalendarUrls(med);
  const fotoHtml = med.foto ? '<img src="'+med.foto+'" class="med-photo-thumb" data-lightbox="'+med.id+'">' : '';
  return '<div style="display:flex; justify-content:space-between; align-items:flex-start;"><div style="display:flex; align-items:center;">'+fotoHtml+'<div><h3>'+escapeHtml(med.nombre)+'</h3>'+
    '<span class="badge '+med.tipo+'">'+tipoLabel+'</span> '+badgeEstado+'</div></div></div>'+
    '<p class="muted" style="margin:8px 0 2px;">Desde el '+fmtHuman(med.fechaInicio)+(med.formaIngesta?' · '+escapeHtml(med.formaIngesta):'')+'</p>'+
    '<p class="muted" style="margin:2px 0 10px;">'+infoFin+'</p>'+
    (med.horarios && med.horarios.length ? '<p class="muted" style="margin:0 0 10px;">🕒 Horarios: '+med.horarios.slice().sort().map(fmtHora).join(', ')+'</p>' : '')+
    (med.notas ? '<p class="muted" style="margin:0 0 10px;">📝 '+escapeHtml(med.notas)+'</p>' : '')+
    '<div style="display:flex; gap:14px; flex-wrap:wrap;">'+
    '<button class="ghost-small" data-edit="'+med.id+'" style="color:var(--pine);">Editar</button>'+
    '<button class="ghost-small" data-toggle="'+med.id+'" style="color:var(--ink-soft);">'+(med.activo===false?'Reactivar':'Marcar inactiva')+'</button>'+
    '<button class="ghost-small" data-del="'+med.id+'">Eliminar</button></div>'+
    '<div style="display:flex; gap:14px; margin-top:6px;">'+
    '<a href="'+cal.gcalUrl+'" target="_blank" rel="noopener" class="ghost-small" style="color:var(--pine); text-decoration:none;">🗓️ Google Calendar</a>'+
    '<a href="'+cal.icsUrl+'" download="recordatorio-'+med.id+'.ics" class="ghost-small" style="text-decoration:none;">⬇️ .ics</a>'+
    '</div>';
}

function wireMedCardButtons(container){
  container.querySelectorAll('[data-lightbox]').forEach(img=>{
    img.addEventListener('click', ()=>abrirLightbox(img.src));
  });
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

/* ==================== toggle Medicación / Vacunas ==================== */
document.querySelectorAll('#medsVacunasSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    medsSubView = b.dataset.sub;
    document.querySelectorAll('#medsVacunasSeg button').forEach(x=>x.classList.toggle('active', x===b));
    document.getElementById('subMeds').style.display = medsSubView==='meds' ? '' : 'none';
    document.getElementById('subVacunas').style.display = medsSubView==='vacunas' ? '' : 'none';
    document.getElementById('medsVacunasTitulo').textContent = medsSubView==='meds' ? 'Medicación' : 'Vacunas';
    if(medsSubView==='vacunas') renderVacunas(); else renderMedsList();
  });
});

/* ==================== vacunas ==================== */
function vacunasCol(petId){ return petsCol().doc(petId).collection('vacunas'); }

function resetVacunaForm(){
  editingVacunaId = null;
  document.getElementById('vacunaFormTitle').textContent = 'Agregar vacuna';
  document.getElementById('vacNombre').value = '';
  document.getElementById('vacFechaAplicada').value = todayStr();
  document.getElementById('vacFechaProxima').value = '';
  document.getElementById('vacNotas').value = '';
  document.getElementById('btnCancelarEdicionVacuna').style.display = 'none';
}

async function guardarVacuna(){
  const nombre = document.getElementById('vacNombre').value.trim();
  const fechaAplicada = document.getElementById('vacFechaAplicada').value || todayStr();
  const fechaProxima = document.getElementById('vacFechaProxima').value || '';
  const notas = document.getElementById('vacNotas').value.trim();
  if(!nombre){ toast('Poné el nombre de la vacuna'); return; }
  const data = {nombre, fechaAplicada, fechaProxima, notas};
  try{
    if(editingVacunaId){
      await vacunasCol(activePetId).doc(editingVacunaId).set(data, {merge:true});
      toast('Vacuna actualizada');
    } else {
      await vacunasCol(activePetId).add(data);
      toast('Vacuna guardada');
    }
  }catch(err){
    console.error(err);
    toast('No se pudo guardar (revisá tu conexión)');
    return;
  }
  resetVacunaForm();
  renderVacunas();
}

function editarVacuna(v){
  editingVacunaId = v.id;
  document.getElementById('vacunaFormTitle').textContent = 'Editar vacuna';
  document.getElementById('vacNombre').value = v.nombre;
  document.getElementById('vacFechaAplicada').value = v.fechaAplicada;
  document.getElementById('vacFechaProxima').value = v.fechaProxima || '';
  document.getElementById('vacNotas').value = v.notas || '';
  document.getElementById('btnCancelarEdicionVacuna').style.display = '';
  document.getElementById('vacunaFormTitle').scrollIntoView({behavior:'smooth', block:'start'});
}

async function eliminarVacuna(id){
  if(!confirm('¿Eliminar esta vacuna?')) return;
  await safeDeleteDoc(vacunasCol(activePetId).doc(id));
  renderVacunas();
  toast('Vacuna eliminada');
}

async function renderVacunas(){
  const wrap = document.getElementById('vacunasListWrap');
  if(!activePetId){ wrap.innerHTML=''; return; }
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  const vacs = await safeListCol(vacunasCol(activePetId));
  vacs.sort((a,b)=> (b.fechaAplicada||'').localeCompare(a.fechaAplicada||''));
  if(vacs.length===0){
    wrap.innerHTML = '<div class="empty-state"><span class="big">💉</span>Todavía no cargaste ninguna vacuna.</div>';
    return;
  }
  const hoy = todayStr();
  wrap.innerHTML = '';
  vacs.forEach(v=>{
    let estadoBadge = '';
    if(v.fechaProxima){
      if(v.fechaProxima < hoy) estadoBadge = '<span class="badge" style="background:var(--rust); color:var(--white);">Refuerzo vencido</span>';
      else if(diffDays(hoy, v.fechaProxima) <= 30) estadoBadge = '<span class="badge fijo">Refuerzo próximo</span>';
    }
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;"><h3>'+escapeHtml(v.nombre)+'</h3>'+estadoBadge+'</div>'+
      '<p class="muted" style="margin:8px 0 2px;">Aplicada el '+fmtHuman(v.fechaAplicada)+'</p>'+
      (v.fechaProxima ? '<p class="muted" style="margin:2px 0 10px;">Próximo refuerzo: <b>'+fmtHuman(v.fechaProxima)+'</b></p>' : '')+
      (v.notas ? '<p class="muted" style="margin:0 0 10px;">📝 '+escapeHtml(v.notas)+'</p>' : '')+
      '<div style="display:flex; gap:14px;">'+
      '<button class="ghost-small" data-edit="'+v.id+'" style="color:var(--pine);">Editar</button>'+
      '<button class="ghost-small" data-del="'+v.id+'">Eliminar</button></div>';
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
    const v = vacs.find(x=>x.id===b.dataset.edit);
    if(v) editarVacuna(v);
  }));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>eliminarVacuna(b.dataset.del)));
}
document.getElementById('btnGuardarVacuna').addEventListener('click', guardarVacuna);
document.getElementById('btnCancelarEdicionVacuna').addEventListener('click', resetVacunaForm);

/* ==================== vista Historial ==================== */
let histBusqueda = '';
function normalizarTexto(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function snippetConContexto(texto, termino, contexto){
  contexto = contexto||40;
  texto = texto||'';
  if(!termino) return texto.length>80 ? texto.slice(0,80)+'…' : texto;
  const idx = normalizarTexto(texto).indexOf(normalizarTexto(termino));
  if(idx===-1) return texto.length>80 ? texto.slice(0,80)+'…' : texto;
  const inicio = Math.max(0, idx-contexto);
  const fin = Math.min(texto.length, idx+termino.length+contexto);
  let snippet = texto.slice(inicio, fin);
  if(inicio>0) snippet = '…'+snippet;
  if(fin<texto.length) snippet += '…';
  return snippet;
}
function resaltar(texto, termino){
  if(!termino) return escapeHtml(texto);
  const idx = normalizarTexto(texto).indexOf(normalizarTexto(termino));
  if(idx===-1) return escapeHtml(texto);
  const antes = texto.slice(0, idx), match = texto.slice(idx, idx+termino.length), despues = texto.slice(idx+termino.length);
  return escapeHtml(antes)+'<mark>'+escapeHtml(match)+'</mark>'+escapeHtml(despues);
}
function logTieneNovedades(log){
  return !!((log.sintomas||'').trim() || (log.notas||'').trim() || log.apetito || log.animo);
}
async function renderHistorial(){
  const wrap = document.getElementById('histList');
  const infoEl = document.getElementById('histBuscarInfo');
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  if(!activePetId){ wrap.innerHTML=''; return; }
  let docs = await safeListCol(logsCol(activePetId));
  docs.sort((a,b)=> b.id.localeCompare(a.id));
  const totalConRegistro = docs.length;
  docs = docs.filter(logTieneNovedades);

  const termino = histBusqueda.trim();
  if(termino){
    const normTermino = normalizarTexto(termino);
    docs = docs.filter(log=>normalizarTexto((log.sintomas||'')+' '+(log.notas||'')).includes(normTermino));
    infoEl.style.display = '';
    infoEl.textContent = docs.length===0
      ? 'No se encontraron registros con "'+termino+'".'
      : docs.length+' resultado'+(docs.length===1?'':'s')+' para "'+termino+'".';
  } else {
    infoEl.style.display = 'none';
  }

  if(docs.length===0){
    let msg = 'Todavía no hay registros guardados.';
    if(termino) msg = 'No encontramos nada con "'+escapeHtml(termino)+'".';
    else if(totalConRegistro>0) msg = 'Todavía no hay días con novedades registradas.';
    wrap.innerHTML = '<div class="empty-state"><span class="big">'+(termino?'🔍':'📖')+'</span>'+msg+'</div>';
    return;
  }
  wrap.innerHTML='';
  docs.forEach(log=>{
    const item = document.createElement('div');
    item.className='hist-item';
    let campo = log.sintomas || '';
    if(termino){
      const enSintomas = normalizarTexto(log.sintomas||'').includes(normalizarTexto(termino));
      if(!enSintomas && normalizarTexto(log.notas||'').includes(normalizarTexto(termino))) campo = log.notas;
    }
    const snippet = campo ? snippetConContexto(campo, termino) : '';
    const resumenHtml = snippet ? (termino ? resaltar(snippet, termino) : escapeHtml(snippet)) : 'Sin novedades en el texto (apetito/ánimo registrado)';
    item.innerHTML = '<div><div class="d">'+fmtHuman(log.id)+'</div><div class="s">'+resumenHtml+'</div></div>'+
      '<div class="dot-status '+(log.completado?'ok':'miss')+'"></div>';
    item.addEventListener('click', ()=>{ selectedDate=log.id; switchView('hoy'); });
    wrap.appendChild(item);
  });
}
document.getElementById('histBuscar').addEventListener('input', (e)=>{
  histBusqueda = e.target.value;
  renderHistorial();
});
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
    if(dataUrl.length > 700000){
      toast('El PDF "'+file.name+'" es muy pesado, no se agregó');
      return null;
    }
    return {tipo:'pdf', nombre:file.name, data:dataUrl};
  } else if(file.type.startsWith('image/')){
    const dataUrl = await compressImage(file, 1400, 320000);
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
    if(totalActual > 780000){
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

/* ==================== compartir documentos con el vet ==================== */
function nombreArchivoConExtension(a, idx){
  let nombre = a.nombre || ('archivo-'+(idx+1));
  if(a.tipo==='pdf' && !/\.pdf$/i.test(nombre)) nombre += '.pdf';
  if(a.tipo==='image' && !/\.(jpe?g|png|webp)$/i.test(nombre)) nombre += '.jpg';
  return nombre;
}

function dataUrlToFile(dataUrl, filename){
  const partes = dataUrl.split(',');
  const mimeMatch = partes[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bin = atob(partes[1]);
  const arr = new Uint8Array(bin.length);
  for(let i=0; i<bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, {type: mime});
}

function archivosToFiles(archivos){
  return archivos.map((a, idx)=> dataUrlToFile(a.data, nombreArchivoConExtension(a, idx)));
}

async function descargarArchivosFallback(archivos){
  for(const [idx, a] of archivos.entries()){
    const link = document.createElement('a');
    link.href = a.data;
    link.download = nombreArchivoConExtension(a, idx);
    document.body.appendChild(link);
    link.click();
    link.remove();
    await new Promise(r=>setTimeout(r, 250));
  }
  toast('Se descargaron los archivos. Adjuntalos desde ahí en WhatsApp o el mail.');
}

async function compartirArchivos(archivos, tituloTexto){
  if(!archivos || archivos.length===0){ toast('No hay archivos para compartir'); return; }
  let files;
  try{
    files = archivosToFiles(archivos);
  }catch(err){
    console.error(err);
    toast('No se pudieron preparar los archivos para compartir');
    return;
  }
  if(navigator.share && navigator.canShare && navigator.canShare({files})){
    try{
      await navigator.share({files, title: tituloTexto || 'Documento', text: tituloTexto || ''});
    }catch(err){
      if(err && err.name !== 'AbortError'){
        console.error(err);
        toast('No se pudo abrir el menú para compartir, se descargarán los archivos');
        await descargarArchivosFallback(archivos);
      }
    }
  } else {
    await descargarArchivosFallback(archivos);
  }
}

async function compartirDocumento(doc){
  const archivos = doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : []);
  await compartirArchivos(archivos, doc.titulo+' · '+fmtHuman(doc.fecha));
}

let modoSeleccionDocs = false;
let docsSeleccionados = new Set();
let docsCache = [];

function actualizarDocsShareBar(){
  const n = docsSeleccionados.size;
  document.getElementById('docsShareCount').textContent = n===1 ? '1 seleccionado' : n+' seleccionados';
  document.getElementById('btnCompartirSeleccionados').disabled = n===0;
}

function entrarModoSeleccionDocs(){
  modoSeleccionDocs = true;
  docsSeleccionados.clear();
  document.getElementById('btnToggleSeleccionDocs').style.display = 'none';
  document.getElementById('docsShareBar').style.display = 'flex';
  actualizarDocsShareBar();
  renderDocumentos();
}

function salirModoSeleccionDocs(){
  modoSeleccionDocs = false;
  docsSeleccionados.clear();
  document.getElementById('btnToggleSeleccionDocs').style.display = '';
  document.getElementById('docsShareBar').style.display = 'none';
  renderDocumentos();
}

async function compartirDocsSeleccionados(){
  const elegidos = docsCache.filter(d=>docsSeleccionados.has(d.id));
  if(elegidos.length===0){ toast('Elegí al menos un documento'); return; }
  let archivos = [];
  elegidos.forEach(d=>{
    const a = d.archivos || (d.imagen ? [{tipo:'image', nombre:'imagen', data:d.imagen}] : []);
    archivos = archivos.concat(a);
  });
  const tituloTexto = elegidos.length===1 ? elegidos[0].titulo : elegidos.length+' documentos';
  await compartirArchivos(archivos, tituloTexto);
}

document.getElementById('btnToggleSeleccionDocs').addEventListener('click', entrarModoSeleccionDocs);
document.getElementById('btnCancelarSeleccionDocs').addEventListener('click', salirModoSeleccionDocs);
document.getElementById('btnCompartirSeleccionados').addEventListener('click', compartirDocsSeleccionados);

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
  try{
    if(editingDocId){
      await docsCol(activePetId).doc(editingDocId).set(data, {merge:true});
      toast('Documento actualizado');
    } else {
      await docsCol(activePetId).add(data);
      toast('Documento guardado');
    }
  }catch(err){
    console.error(err);
    if(err && err.code==='invalid-argument'){
      toast('Los archivos son muy pesados en conjunto. Sacá alguno o subilos en documentos separados.');
    } else {
      toast('No se pudo guardar el documento (revisá tu conexión)');
    }
    return;
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

let docViewerActual = null;
function abrirDocumento(doc){
  docViewerActual = doc;
  const archivos = doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : []);
  document.getElementById('docViewerTitulo').textContent = doc.titulo+' · '+fmtHuman(doc.fecha);
  const body = document.getElementById('docViewerBody');
  body.innerHTML = '';
  archivos.forEach(a=>{
    if(a.tipo==='pdf'){
      const link = document.createElement('a');
      link.className = 'doc-viewer-pdf-link';
      link.href = a.data;
      link.download = a.nombre;
      link.textContent = '📄 Descargar '+a.nombre;
      body.appendChild(link);
      const embed = document.createElement('embed');
      embed.src = a.data;
      embed.type = 'application/pdf';
      body.appendChild(embed);
    } else {
      const img = document.createElement('img');
      img.src = a.data;
      body.appendChild(img);
    }
  });
  document.getElementById('docViewerOverlay').style.display = 'block';
  window.scrollTo(0,0);
}
function cerrarDocViewer(){
  docViewerActual = null;
  document.getElementById('docViewerOverlay').style.display = 'none';
  document.getElementById('docViewerBody').innerHTML = '';
}
document.getElementById('btnCerrarDocViewer').addEventListener('click', cerrarDocViewer);
document.getElementById('btnCompartirDocViewer').addEventListener('click', ()=>{
  if(docViewerActual) compartirDocumento(docViewerActual);
});

async function renderDocumentos(){
  const wrap = document.getElementById('docsListWrap');
  if(!activePetId){ wrap.innerHTML=''; return; }
  wrap.innerHTML = '<p class="muted">Cargando...</p>';
  const docs = await safeListCol(docsCol(activePetId));
  docs.sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||''));
  docsCache = docs;
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
    const checkboxHtml = modoSeleccionDocs
      ? '<input type="checkbox" class="doc-select-check" data-select="'+doc.id+'" '+(docsSeleccionados.has(doc.id)?'checked':'')+'>'
      : '';
    card.innerHTML =
      checkboxHtml +
      '<div class="doc-thumb-wrap" data-open="'+doc.id+'">'+thumbHtml+badge+'</div>'+
      '<div class="doc-info">'+
        '<b>'+escapeHtml(doc.titulo)+'</b>'+
        '<p class="muted" style="margin:2px 0 8px;">'+fmtHuman(doc.fecha)+(archivos.length>1?' · '+archivos.length+' archivos':'')+'</p>'+
        '<div style="display:flex; gap:14px; flex-wrap:wrap;">'+
          '<button class="ghost-small" data-share="'+doc.id+'" style="color:var(--sage-light);">↗ Compartir</button>'+
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
  wrap.querySelectorAll('[data-share]').forEach(b=>{
    b.addEventListener('click', (e)=>{
      e.stopPropagation();
      const doc = docs.find(d=>d.id===b.dataset.share);
      if(doc) compartirDocumento(doc);
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
  wrap.querySelectorAll('.doc-select-check').forEach(chk=>{
    chk.addEventListener('click', e=>e.stopPropagation());
    chk.addEventListener('change', ()=>{
      if(chk.checked) docsSeleccionados.add(chk.dataset.select);
      else docsSeleccionados.delete(chk.dataset.select);
      actualizarDocsShareBar();
    });
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
    row.innerHTML = '<span class="pet-nombre">'+escapeHtml(p.nombre)+'</span>'+
      '<button type="button" class="icon-btn" data-editnombre="'+p.id+'" title="Editar nombre">✎</button>'+
      '<button type="button" class="tag-activa" data-select="'+p.id+'" style="background:'+(esActiva?'var(--pine)':'var(--paper-2)')+'; color:'+(esActiva?'var(--white)':'var(--ink-soft)')+';">'+(esActiva?'Activa':'Elegir')+'</button>'+
      (pets.length>1 ? '<button type="button" class="icon-btn" data-del="'+p.id+'" title="Eliminar mascota">✕</button>' : '');
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('[data-editnombre]').forEach(b=>{
    b.addEventListener('click', ()=>iniciarEdicionNombrePet(b.closest('.pet-row'), pets.find(p=>p.id===b.dataset.editnombre)));
  });
  wrap.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click', ()=>setActivePet(b.dataset.select)));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>eliminarMascota(b.dataset.del)));
}
function iniciarEdicionNombrePet(row, p){
  if(!p) return;
  const esActiva = p.id===activePetId;
  row.innerHTML = '<input type="text" class="pet-edit-input" value="'+escapeHtml(p.nombre)+'">'+
    '<button type="button" class="icon-btn" data-savenombre title="Guardar">✓</button>'+
    '<button type="button" class="icon-btn" data-cancelnombre title="Cancelar">✕</button>';
  const input = row.querySelector('.pet-edit-input');
  input.focus();
  input.select();
  const guardar = ()=>renombrarMascota(p.id, input.value.trim());
  row.querySelector('[data-savenombre]').addEventListener('click', guardar);
  row.querySelector('[data-cancelnombre]').addEventListener('click', renderPetsList);
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); guardar(); }
    if(e.key==='Escape'){ e.preventDefault(); renderPetsList(); }
  });
}
document.getElementById('btnAgregarMascota').addEventListener('click', agregarMascota);

/* ==================== ajustes: compartir ==================== */
async function renderCompartir(){
  const h = await safeGetDoc(householdRef());
  if(!h) return;
  document.getElementById('householdIdText').textContent = householdId;
  const shareUrl = location.origin + location.pathname + '?household=' + encodeURIComponent(householdId);
  document.getElementById('shareLinkText').textContent = shareUrl;
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
document.getElementById('btnCopyLink').addEventListener('click', ()=>{
  const link = document.getElementById('shareLinkText').textContent;
  navigator.clipboard.writeText(link).then(()=>toast('Link copiado')).catch(()=>toast('No se pudo copiar'));
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
  try{
    await consultasCol(activePetId).add({texto:txt, resuelto:false, ts:Date.now()});
    document.getElementById('vetTexto').value = '';
    renderVet();
  }catch(err){
    console.error(err);
    toast('No se pudo guardar (revisá tu conexión)');
  }
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
function iniciarEdicionVet(row, it){
  row.innerHTML =
    '<input type="checkbox" disabled '+(it.resuelto?'checked':'')+'>'+
    '<input type="text" class="vet-edit-input" value="'+escapeHtml(it.texto)+'">'+
    '<button class="icon-btn" data-save="'+it.id+'" title="Guardar">✓</button>'+
    '<button class="icon-btn" data-cancel="'+it.id+'" title="Cancelar">✕</button>';
  const input = row.querySelector('.vet-edit-input');
  input.focus();
  input.select();
  const guardar = ()=>guardarEdicionVet(it.id, input.value);
  row.querySelector('[data-save]').addEventListener('click', guardar);
  row.querySelector('[data-cancel]').addEventListener('click', renderVet);
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); guardar(); }
    if(e.key==='Escape'){ e.preventDefault(); renderVet(); }
  });
}
async function guardarEdicionVet(id, texto){
  texto = texto.trim();
  if(!texto){ toast('El texto no puede quedar vacío'); return; }
  try{
    await safeSetDoc(consultasCol(activePetId).doc(id), {texto});
    toast('Actualizado');
  }catch(err){
    console.error(err);
    toast('No se pudo guardar (revisá tu conexión)');
  }
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
      '<button class="icon-btn" data-edit="'+it.id+'" title="Editar">✎</button>'+
      '<button class="icon-btn" data-del="'+it.id+'" title="Eliminar">✕</button>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(chk=>{
    chk.addEventListener('change', ()=>toggleConsulta(chk.dataset.id, chk.checked));
  });
  wrap.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const it = items.find(x=>x.id===b.dataset.edit);
      if(it) iniciarEdicionVet(b.closest('.vet-item'), it);
    });
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

/* ==================== backup completo ==================== */
function slugFilename(s){
  const base = (s||'archivo').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9\-_ ]/g,'').trim().replace(/\s+/g,'-').slice(0,60);
  return base || 'archivo';
}
function dataUrlBase64(dataUrl){
  const idx = dataUrl.indexOf(',');
  return idx>=0 ? dataUrl.slice(idx+1) : dataUrl;
}
function extFromDataUrl(dataUrl, fallback){
  const m = /^data:([^;]+);/.exec(dataUrl);
  if(!m) return fallback;
  const mime = m[1];
  if(mime==='application/pdf') return 'pdf';
  if(mime==='image/png') return 'png';
  if(mime==='image/webp') return 'webp';
  if(mime==='image/jpeg' || mime==='image/jpg') return 'jpg';
  return fallback;
}
async function descargarBackup(){
  if(typeof JSZip==='undefined'){
    toast('No se pudo cargar la herramienta de backup (revisá tu conexión a internet)');
    return;
  }
  const btn = document.getElementById('btnDescargarBackup');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparando backup...';
  try{
    const zip = new JSZip();
    const manifest = { generado: new Date().toISOString(), mascotas: [] };
    const carpetasUsadas = new Set();

    for(const pet of pets){
      let carpeta = slugFilename(pet.nombre || 'mascota'), n=2;
      while(carpetasUsadas.has(carpeta)){ carpeta = slugFilename(pet.nombre||'mascota')+'-'+n; n++; }
      carpetasUsadas.add(carpeta);
      const petFolder = zip.folder(carpeta);

      const [medsArr, logsArr, docsArr, vacunasArr, consultasArr] = await Promise.all([
        safeListCol(medsCol(pet.id)),
        safeListCol(logsCol(pet.id)),
        safeListCol(docsCol(pet.id)),
        safeListCol(vacunasCol(pet.id)),
        safeListCol(consultasCol(pet.id))
      ]);

      const medsFolder = petFolder.folder('medicacion-fotos');
      const medsManifest = medsArr.map(med=>{
        const m = Object.assign({}, med);
        if(med.foto){
          const ext = extFromDataUrl(med.foto, 'jpg');
          let fname = slugFilename(med.nombre)+'.'+ext, k=2;
          while(medsFolder.file(fname)){ fname = slugFilename(med.nombre)+'-'+k+'.'+ext; k++; }
          medsFolder.file(fname, dataUrlBase64(med.foto), {base64:true});
          m.foto = 'medicacion-fotos/'+fname;
        }
        return m;
      });

      const docsFolder = petFolder.folder('documentos');
      const docsManifest = docsArr.map(doc=>{
        const d = Object.assign({}, doc);
        const archivos = doc.archivos || (doc.imagen ? [{tipo:'image', nombre:'imagen', data:doc.imagen}] : []);
        d.archivos = archivos.map((a, idx)=>{
          const ext = extFromDataUrl(a.data, a.tipo==='pdf'?'pdf':'jpg');
          const base = slugFilename(doc.titulo)+(archivos.length>1 ? '-'+(idx+1) : '');
          let fname = base+'.'+ext, k=2;
          while(docsFolder.file(fname)){ fname = base+'-'+k+'.'+ext; k++; }
          docsFolder.file(fname, dataUrlBase64(a.data), {base64:true});
          return { nombre: a.nombre, tipo: a.tipo, archivo: 'documentos/'+fname };
        });
        delete d.imagen;
        return d;
      });

      manifest.mascotas.push({
        nombre: pet.nombre,
        carpeta: carpeta,
        medicaciones: medsManifest,
        historial: logsArr,
        documentos: docsManifest,
        vacunas: vacunasArr,
        paraElVet: consultasArr
      });
    }

    zip.file('datos.json', JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-petmeds-'+todayStr()+'.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    toast('Backup descargado');
  }catch(err){
    console.error(err);
    toast('No se pudo generar el backup'+(err && err.message ? ': '+err.message : ''));
  }finally{
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}
document.getElementById('btnDescargarBackup').addEventListener('click', descargarBackup);

/* ==================== navegación ==================== */
function switchView(name){
  if(name!=='documentos' && modoSeleccionDocs) salirModoSeleccionDocs();
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
  if(activeView==='view-meds'){ if(medsSubView==='vacunas') await renderVacunas(); else renderMedsList(); }
  if(activeView==='view-historial') await renderHistorial();
  if(activeView==='view-documentos') await renderDocumentos();
  if(activeView==='view-vet') await renderVet();
  if(activeView==='view-ajustes') await renderAjustes();

  const hoy = todayStr();
  const activos = meds.filter(m=>m.activo!==false && !estaFinalizada(m, hoy));
  const tomandoHoy = activos.filter(m=>dosisEnFecha(m, hoy)!==null).length;
  const proximas7 = activos.filter(m=>{
    if(dosisEnFecha(m, hoy)!==null) return false;
    let inicioProx = null;
    if(m.tipo==='recurrente'){
      inicioProx = m.proximaFecha || m.fechaInicio;
    } else if(m.fechaInicio > hoy){
      inicioProx = m.fechaInicio;
    }
    if(!inicioProx) return false;
    const dias = diffDays(hoy, inicioProx);
    return dias>=1 && dias<=7;
  }).length;
  let subTxt = tomandoHoy>0
    ? 'Tomando '+tomandoHoy+' medicación'+(tomandoHoy===1?'':'es')
    : 'No está tomando medicación hoy';
  if(proximas7>0) subTxt += '. '+proximas7+' medicación'+(proximas7===1?'':'es')+' se agregará'+(proximas7===1?'':'n')+' en 7 días o menos.';
  document.getElementById('topSub').textContent = subTxt;
}

/* ==================== eventos formulario medicación ==================== */
document.querySelectorAll('#medTipoSeg button').forEach(b=>b.addEventListener('click', ()=>setMedTipo(b.dataset.tipo)));
document.querySelectorAll('#recDosisModoSeg button').forEach(b=>b.addEventListener('click', ()=>setRecDosisModo(b.dataset.modo)));
document.querySelectorAll('#recFinModoSeg button').forEach(b=>b.addEventListener('click', ()=>setRecFinModo(b.dataset.modo)));
document.getElementById('medUnidadIntervalo').addEventListener('change', (e)=>{ recUnidadIntervalo = e.target.value; actualizarCalculos(); });
document.getElementById('medFinVeces').addEventListener('input', ()=>actualizarCalculos());
document.getElementById('medFinFecha').addEventListener('input', ()=>actualizarCalculos());
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
