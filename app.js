/* =======================================================================
   Dr. Francisco L. Calingasan Memorial Colleges Foundation Inc. — Portal
   Single-file app: client-side UI backed by a Supabase table (app_state)
   holding the whole DB as one JSON blob — see SUPABASE_SETUP.sql
   ======================================================================= */

const SCHOOL_NAME = "Dr. Francisco L. Calingasan Memorial Colleges Foundation Inc.";
const DB_KEY = "DFLC_school_db_v1";
const SCHOOL_LOGO_SRC = "LOGO.jpg";

const SUPABASE_URL = "https://wcowyknjsjellpcubsam.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FYjHNYr3EUAnJeV03Ibu9g_f4BmX7EX";
const APP_STATE_TABLE = "app_state"; // single row/column JSON store, see SQL setup notes

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let toastTimer = null;
let state = {
  currentUser: null,
  loginRole: 'admin',
  loginError: '',
  view: 'login',
  adminTab: 'overview',
  teacherTab: 'roster',
  studentTab: 'overview',
  selectedClassId: null,
  selectedClassSubjectId: null,
  selectedStudentSubjectId: null,
  modal: null,
  sidebarOpen: false,
  toast: null,
};

function uid(prefix){ return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function lrnExists(lrn, exceptUserId){
  return db.users.some(user=>user.id!==exceptUserId && String(user.lrn||'')===String(lrn));
}
function generateUniqueLrn(exceptUserId){
  let lrn = '';
  do{
    lrn = String(Math.floor(100000000000 + Math.random() * 900000000000));
  }while(lrnExists(lrn, exceptUserId));
  return lrn;
}
function ensureStudentLrns(){
  db.users.filter(user=>user.role==='student' && !user.lrn).forEach(user=>{
    user.lrn = generateUniqueLrn(user.id);
  });
}

function defaultDB(){
  return {
    users: [
      { id: uid('u'), role:'admin', username:'123', email:'123', password:'123', name:'ADMIN' },
    ],
    classes: [],
    subjects: [],
    classSubjects: [],
    materials: [],
    attendance: [],
    grades: [],
    messages: [],
    submissions: [],
    behavior: [],
  };
}

async function loadDB(){
  try{
    const { data, error } = await supabaseClient
      .from(APP_STATE_TABLE)
      .select('value')
      .eq('key', DB_KEY)
      .maybeSingle();
    if(error) throw error;
    if(data && data.value){ db = normalizeDB(data.value); ensureStudentLrns(); await saveDB(); return; }
  }catch(e){
    console.error('loadDB (supabase) failed, falling back to local copy', e);
    try{
      const cached = localStorage.getItem(DB_KEY);
      if(cached){ db = normalizeDB(JSON.parse(cached)); ensureStudentLrns(); return; }
    }catch(e2){ /* ignore */ }
  }
  db = defaultDB();
  await saveDB();
}
function normalizeDB(data){
  data.users = Array.isArray(data.users) ? data.users : [];
  data.classes = Array.isArray(data.classes) ? data.classes : [];
  data.materials = Array.isArray(data.materials) ? data.materials : [];
  data.attendance = Array.isArray(data.attendance) ? data.attendance : [];
  data.grades = Array.isArray(data.grades) ? data.grades : [];
  data.messages = Array.isArray(data.messages) ? data.messages : [];
  data.subjects = Array.isArray(data.subjects) ? data.subjects : [];
  data.classSubjects = Array.isArray(data.classSubjects) ? data.classSubjects : [];
  data.submissions = Array.isArray(data.submissions) ? data.submissions : [];
  data.behavior = Array.isArray(data.behavior) ? data.behavior : [];
  const exampleUsernames = new Set(['teacher1','teacher2','student1','student2','student3','student4']);
  const removedUserIds = new Set(data.users.filter(user=>exampleUsernames.has(user.username)).map(user=>user.id));
  data.users = data.users.filter(user=>!exampleUsernames.has(user.username));
  const removedClassIds = new Set(data.classes.filter(cls=>(cls.grade==='Grade 1' && ['Section 1 - Faith','Section 2 - Hope'].includes(cls.section)) || (cls.grade==='College' && cls.section==='BE1101') || removedUserIds.has(cls.teacherId)).map(cls=>cls.id));
  data.classes = data.classes.filter(cls=>!removedClassIds.has(cls.id));
  data.users.forEach(user=>{ if(removedClassIds.has(user.classId)) user.classId = ''; });
  const removedClassSubjectIds = new Set(data.classSubjects.filter(cs=>removedClassIds.has(cs.classId) || removedUserIds.has(cs.teacherId)).map(cs=>cs.id));
  data.classSubjects = data.classSubjects.filter(cs=>!removedClassSubjectIds.has(cs.id));
  const removedMaterialIds = new Set(data.materials.filter(material=>removedClassIds.has(material.classId) || removedClassSubjectIds.has(material.classSubjectId)).map(material=>material.id));
  data.materials = data.materials.filter(material=>!removedMaterialIds.has(material.id));
  data.attendance = data.attendance.filter(record=>!removedClassIds.has(record.classId));
  data.grades = data.grades.filter(grade=>!removedClassIds.has(grade.classId) && !removedUserIds.has(grade.studentId) && !removedMaterialIds.has(grade.materialId));
  data.submissions = data.submissions.filter(sub=>!removedUserIds.has(sub.studentId) && !removedMaterialIds.has(sub.materialId));
  data.behavior = data.behavior.filter(rec=>!removedUserIds.has(rec.studentId) && !removedClassIds.has(rec.classId));
  data.users.forEach(user=>{
    if(!user.email) user.email = user.username || '';
  });

  // --- Safeguard: guarantee the default admin login (123 / 123) always works,
  // even if a previously saved database has different/missing admin credentials.
  let admin = data.users.find(user=>user.role==='admin');
  if(!admin){
    data.users.push({ id: uid('u'), role:'admin', username:'123', email:'123', password:'123', name:'ADMIN' });
  }else{
    admin.username = '123';
    admin.email = '123';
    admin.password = '123';
    if(!admin.name) admin.name = 'ADMIN';
  }

  return data;
}
async function saveDB(){
  try{
    localStorage.setItem(DB_KEY, JSON.stringify(db)); // quick local fallback/cache
  }catch(e){ /* ignore quota errors */ }
  try{
    const { error } = await supabaseClient
      .from(APP_STATE_TABLE)
      .upsert({ key: DB_KEY, value: db, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if(error) throw error;
  }catch(e){
    console.error('saveDB (supabase) failed — changes only saved locally for now', e);
  }
}
function showToast(msg){
  if(toastTimer) clearTimeout(toastTimer);
  state.toast = msg;
  render();
  toastTimer = setTimeout(()=>{ state.toast = null; toastTimer = null; render(); }, 2400);
}

/* ---------------------- helpers ---------------------- */
function esc(str){ return (str===undefined||str===null) ? '' : String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function classLabel(cls){ return cls ? `${cls.grade} — ${cls.section}` : '—'; }
function getClass(id){ return db.classes.find(c=>c.id===id); }
function getUser(id){ return db.users.find(u=>u.id===id); }
function getSubject(id){ return db.subjects.find(s=>s.id===id); }
function getClassSubject(id){ return db.classSubjects.find(cs=>cs.id===id); }
function subjectAssignmentsOfClass(classId){ return db.classSubjects.filter(cs=>cs.classId===classId && getSubject(cs.subjectId)); }
function subjectAssignmentsOfTeacher(teacherId){ return db.classSubjects.filter(cs=>cs.teacherId===teacherId && getSubject(cs.subjectId)); }
function classesOfTeacher(teacherId){
  const ids = new Set(subjectAssignmentsOfTeacher(teacherId).map(cs=>cs.classId));
  return db.classes.filter(c=>c.teacherId===teacherId || ids.has(c.id));
}
function studentsOfClass(classId){ return db.users.filter(u=>u.role==='student' && u.classId===classId); }
function materialsOfClass(classId){ return db.materials.filter(m=>m.classId===classId).sort((a,b)=> (b.postedAt||'').localeCompare(a.postedAt||'')); }
function materialsOfClassSubject(classSubjectId){ return db.materials.filter(m=>m.classSubjectId===classSubjectId).sort((a,b)=> (b.postedAt||'').localeCompare(a.postedAt||'')); }
function gradesOf(studentId){ return db.grades.filter(g=>g.studentId===studentId); }
function submissionFor(materialId, studentId){ return db.submissions.find(s=>s.materialId===materialId && s.studentId===studentId); }
function submissionsOfMaterial(materialId){ return db.submissions.filter(s=>s.materialId===materialId); }
 function attendanceOf(studentId, classId, classSubjectId){
   const subjectRecords = db.attendance.filter(a=>a.classId===classId && a.classSubjectId===classSubjectId);
   const records = subjectRecords.length ? subjectRecords : db.attendance.filter(a=>a.classId===classId && !a.classSubjectId);
   return records.map(a=>({date:a.date, status:a.records[studentId]||'—'}));
 }
function fmtDate(d){ if(!d) return '—'; const dt = new Date(d+'T00:00:00'); if(isNaN(dt)) return d; return dt.toLocaleDateString('en-US',{month:'short', day:'numeric', year:'numeric'}); }
function typePill(type){
  const map = {Assignment:'pill-gold', Quiz:'pill-maroon', Project:'pill-slate', Handout:'pill-success'};
  return `<span class="pill ${map[type]||'pill-slate'}">${esc(type)}</span>`;
}
function fmtFileSize(bytes){
  if(bytes===undefined || bytes===null) return '';
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}
function submitWorkBlock(m){
  if(!m.allowOnlineSubmission) return '';
  const sub = submissionFor(m.id, state.currentUser.id);
  return `<div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
    ${sub ? `<span class="pill pill-success">Submitted ${fmtDate((sub.submittedAt||'').slice(0,10))}</span>` : ''}
    <button type="button" class="btn ${sub?'btn-ghost':'btn-gold'} btn-sm" data-submit-work="${m.id}">${sub ? 'Update submission' : 'Submit file'}</button>
  </div>`;
}
function attachmentsHtml(material){
  const files = Array.isArray(material.attachments) ? material.attachments : [];
  if(!files.length) return '';
  return `<div class="attachment-list">${files.map(f=>`<a class="attachment-chip" href="${esc(f.dataUrl)}" download="${esc(f.name)}" title="Download ${esc(f.name)}">📎 ${esc(f.name)}${f.size!==undefined?` <span>(${fmtFileSize(f.size)})</span>`:''}</a>`).join('')}</div>`;
}

/* ---------------------- thresholds & analytics helpers ---------------------- */
const PASSING_THRESHOLD = 75;
const ABSENCE_ALERT_THRESHOLD = 3;
function studentAverage(studentId){
  const g = gradesOf(studentId);
  if(!g.length) return null;
  return Math.round(100*g.reduce((sum,x)=>sum+(x.score/x.maxScore),0)/g.length);
}
function studentAbsenceCount(studentId, classId){
  return db.attendance.filter(a=>a.classId===classId).reduce((sum,a)=>sum + (a.records[studentId]==='absent'?1:0), 0);
}
function barChartHtml(items, opts){
  opts = opts || {};
  if(!items || !items.length) return '';
  const max = opts.max || Math.max(1, ...items.map(i=>i.value));
  return `<div class="bar-chart">${items.map(i=>{
    const pct = Math.max(2, Math.round((Math.min(i.value,max)/max)*100));
    const color = i.color || 'var(--gold)';
    return `<div class="bar-col"><div class="bar-val">${i.value}${opts.suffix||''}</div><div class="bar" style="height:${pct}%; background:${color};"></div><div class="bar-label" title="${esc(i.label)}">${esc(i.label)}</div></div>`;
  }).join('')}</div>`;
}

/* ---------------------- behavior records ---------------------- */
const BEHAVIOR_TYPES = ['Positive','Negative','Neutral'];
function behaviorOf(studentId){ return db.behavior.filter(b=>b.studentId===studentId).sort((a,b)=>(b.date||'').localeCompare(a.date||'')); }
function behaviorPill(type){
  const map = {Positive:'pill-success', Negative:'pill-danger', Neutral:'pill-slate'};
  return `<span class="pill ${map[type]||'pill-slate'}">${esc(type)}</span>`;
}

/* ---------------------- school logo ---------------------- */
function schoolLogo(size, className){
  size = size || 110;
  const classes = ['school-logo', className].filter(Boolean).join(' ');
  return `<img class="${classes}" src="${SCHOOL_LOGO_SRC}" style="--logo-size:${size}px;" width="${size}" height="${size}" alt="${esc(SCHOOL_NAME)} seal">`;
}

/* ---------------------- auth ---------------------- */
function attemptLogin(identifier, password){
  const normalized = identifier.toLowerCase();
  const u = db.users.find(x=>(x.username.toLowerCase()===normalized || (x.email||'').toLowerCase()===normalized) && x.password===password);
  if(!u){ state.loginError = 'Incorrect username or password for this account type.'; render(); return; }
  state.currentUser = u;
  state.loginError = '';
  state.view = u.role;
  if(u.role==='teacher'){
    const cls = classesOfTeacher(u.id);
    state.selectedClassId = cls.length ? cls[0].id : null;
    const assignments = state.selectedClassId ? subjectAssignmentsOfClass(state.selectedClassId).filter(cs=>cs.teacherId===u.id) : [];
    state.selectedClassSubjectId = assignments.length ? assignments[0].id : null;
    state.teacherTab = 'overview';
  }
  if(u.role==='admin') state.adminTab = 'overview';
  if(u.role==='student') state.studentTab = 'overview';
  if(u.role==='student') state.selectedStudentSubjectId = null;
  render();
}
function logout(){
  state.currentUser = null; state.view='login'; state.loginError=''; state.sidebarOpen=false;
  render();
}

/* ---------------------- render dispatch ---------------------- */
function render(){
  const existingModal = document.getElementById('modal-bg');
  if(existingModal) existingModal.remove();
  const app = document.getElementById('app');
  const existingToast = document.querySelector('.toast');
  if(existingToast) existingToast.remove();
  if(state.view==='login'){ app.innerHTML = renderLogin(); attachLoginHandlers(); }
  else if(state.view==='admin'){ app.innerHTML = renderShell(renderAdminMain(), 'admin'); attachShellHandlers(); attachAdminHandlers(); }
  else if(state.view==='teacher'){ app.innerHTML = renderShell(renderTeacherMain(), 'teacher'); attachShellHandlers(); attachTeacherHandlers(); }
  else if(state.view==='student'){ app.innerHTML = renderShell(renderStudentMain(), 'student'); attachShellHandlers(); attachStudentHandlers(); }
  if(state.modal){ renderModal(); }
  if(state.toast){
    const t = document.createElement('div'); t.className='toast'; t.textContent = state.toast;
    document.body.appendChild(t);
  }
}

/* ======================= LOGIN VIEW ======================= */
function renderLogin(){
  return `
  <div class="login-wrap">
    <div class="login-visual">
      ${schoolLogo(150, 'school-logo-lg')}
      <div class="eyebrow">Foundation Portal</div>
      <h1>${esc(SCHOOL_NAME)}</h1>
      <p>One portal for the registrar's office, the faculty, and every learner — enrollment, class records, attendance, and evaluation, kept in one place.</p>
    </div>
    <div class="login-panel">
      <div class="login-card">
        <div class="login-card-logo">${schoolLogo(82)}</div>
        <div class="eyebrow">Sign in</div>
        <h2>Welcome back</h2>
        <div class="sub">Sign in with your username or school email. Your account type will open automatically.</div>
        ${state.loginError ? `<div class="login-error">${esc(state.loginError)}</div>` : ''}
        <form id="login-form">
          <div class="field">
            <label>Username or school email</label>
            <input type="text" id="login-identifier" autocomplete="username" required>
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="login-password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary">Sign in</button>
        </form>
        </div>
      </div>
    </div>
  </div>`;
}
function attachLoginHandlers(){
  const form = document.getElementById('login-form');
  if(form){
    form.onsubmit = (e)=>{
      e.preventDefault();
      const u = document.getElementById('login-identifier').value.trim();
      const p = document.getElementById('login-password').value;
      attemptLogin(u,p);
    };
  }
}

/* ======================= SHELL (sidebar + main) ======================= */
function renderShell(mainHTML, role){
  const u = state.currentUser;
  const navItems = {
    admin: [
      ['overview','Overview'],['teachers','Teachers'],['students','Students'],
      ['classes','Classes & Sections'],['subjects','Subjects / Courses'],['evaluations','Evaluations'],['behavior','Behavior Log'],
    ],
    teacher: [
      ['overview','Overview'],['roster','My Classes'],['post','Post Work'],['attendance','Attendance'],['gradebook','Gradebook'],['behavior','Behavior'],
    ],
    student: [
      ['overview','Overview'],['grades','My Grades'],['subjects','Subjects / Courses'],['work','Class Work'],['behavior','My Behavior'],
    ],
  };
  const activeTab = role==='admin'?state.adminTab: role==='teacher'?state.teacherTab: state.studentTab;
  return `
  <div class="shell">
    <button class="menu-toggle" id="menu-toggle">☰ Menu</button>
    <div class="sidebar ${state.sidebarOpen?'open':''}" id="sidebar">
      <div class="sidebar-brand">
        ${schoolLogo(42)}
        <div>
          <div class="name">DFLC Memorial<br>Colleges</div>
          <div class="tag">${role} portal</div>
        </div>
      </div>
      <nav>
        ${navItems[role].map(([key,label])=>`<button class="nav-item ${activeTab===key?'active':''}" data-nav="${key}">${label}</button>`).join('')}
      </nav>
      <div class="sidebar-foot">
        <div class="who">${esc(u.name)}</div>
        <div class="who-role">${role}</div>
        <button class="btn btn-ghost btn-sm" id="logout-btn" style="margin-top:12px; width:100%; color:#F6F1E4; border-color:rgba(246,241,228,0.3);">Sign out</button>
      </div>
    </div>
    <div class="main">
      ${renderAccountTools(role)}
      ${mainHTML}
    </div>
  </div>`;
}
function renderAccountTools(role){
  const u = state.currentUser;
  const notifications = unreadNotificationsForUser(u, role);
  return `<div class="account-tools">
    <button class="tool-btn" data-open-account-modal="notifications" aria-label="Notifications" title="Notifications">&#128276;${notifications.length ? `<span class="notification-count">${notifications.length}</span>` : ''}</button>
    <button class="tool-btn" data-open-account-modal="messages" aria-label="Messages" title="Messages">&#128172;</button>
    <button class="profile-btn" data-open-account-modal="profile" title="Profile">${userAvatar(u)}<span class="profile-name">${esc(u.name)}</span></button>
    <button class="tool-btn settings-btn" data-open-account-modal="settings" aria-label="Account settings" title="Account settings">&#9881;</button>
  </div>`;
}
function initials(name){ return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase(); }
function userAvatar(user, className){
  const classes = ['avatar', className].filter(Boolean).join(' ');
  if(user && user.photoDataUrl) return `<img class="${classes}" src="${esc(user.photoDataUrl)}" alt="${esc(user.name)} profile picture">`;
  return `<span class="${classes}">${esc(initials(user && user.name))}</span>`;
}
function notificationsForUser(user, role){
  if(!user) return [];
  if(role==='admin'){
    const items = [];
    const unassigned = db.classes.filter(c=>!c.teacherId).length;
    const unenrolled = db.users.filter(u=>u.role==='student' && !u.classId).length;
    if(unassigned) items.push({id:`admin-unassigned-${unassigned}`, title:'Sections need teachers', body:`${unassigned} section${unassigned===1?'':'s'} still need a teacher assignment.`});
    if(unenrolled) items.push({id:`admin-unenrolled-${unenrolled}`, title:'Students not enrolled', body:`${unenrolled} student${unenrolled===1?'':'s'} still need a section.`});
    const lowStudents = db.users.filter(u=>u.role==='student').filter(s=>{ const avg=studentAverage(s.id); return avg!==null && avg<PASSING_THRESHOLD; }).length;
    if(lowStudents) items.push({id:`admin-lowgrades-${lowStudents}`, title:'Students below passing', body:`${lowStudents} student${lowStudents===1?'':'s'} school-wide ${lowStudents===1?'is':'are'} averaging below ${PASSING_THRESHOLD}%.`});
    return items;
  }
  if(role==='student'){
    const cls = getClass(user.classId);
    const items = cls ? db.materials.filter(m=>m.classId===cls.id && m.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5).map(m=>({id:`student-due-${m.id}`, title:`Due ${fmtDate(m.dueDate)}`, body:m.title})) : [];
    const avg = studentAverage(user.id);
    if(avg!==null && avg<PASSING_THRESHOLD) items.push({id:`student-lowgrade-${avg}`, title:'Grade alert', body:`Your overall average is ${avg}%, below the ${PASSING_THRESHOLD}% passing mark.`});
    if(cls){
      const absences = studentAbsenceCount(user.id, cls.id);
      if(absences>=ABSENCE_ALERT_THRESHOLD) items.push({id:`student-absences-${absences}`, title:'Attendance alert', body:`You have ${absences} recorded absences this term.`});
    }
    return items;
  }
  const assignments = subjectAssignmentsOfTeacher(user.id);
  const items = assignments.length ? [{id:`teacher-assignments-${assignments.length}`, title:'Teaching assignments', body:`You are assigned to ${assignments.length} subject${assignments.length===1?'':'s'}.`}] : [];
  const teacherClasses = classesOfTeacher(user.id);
  const atRiskIds = new Set();
  const absenceRiskIds = new Set();
  teacherClasses.forEach(c=>{
    studentsOfClass(c.id).forEach(s=>{
      const avg = studentAverage(s.id);
      if(avg!==null && avg<PASSING_THRESHOLD) atRiskIds.add(s.id);
      if(studentAbsenceCount(s.id, c.id)>=ABSENCE_ALERT_THRESHOLD) absenceRiskIds.add(s.id);
    });
  });
  if(atRiskIds.size) items.push({id:`teacher-atrisk-${atRiskIds.size}`, title:'Students falling behind', body:`${atRiskIds.size} student${atRiskIds.size===1?'':'s'} in your classes ${atRiskIds.size===1?'is':'are'} averaging below ${PASSING_THRESHOLD}%.`});
  if(absenceRiskIds.size) items.push({id:`teacher-absences-${absenceRiskIds.size}`, title:'Attendance alert', body:`${absenceRiskIds.size} student${absenceRiskIds.size===1?'':'s'} in your classes ${absenceRiskIds.size===1?'has':'have'} ${ABSENCE_ALERT_THRESHOLD}+ absences.`});
  return items;
}
function unreadNotificationsForUser(user, role){
  const seen = new Set(user && Array.isArray(user.seenNotificationIds) ? user.seenNotificationIds : []);
  return notificationsForUser(user, role).filter(item=>!seen.has(item.id));
}
async function markNotificationsRead(){
  const user = state.currentUser;
  if(!user) return;
  const ids = notificationsForUser(user, state.view).map(item=>item.id);
  user.seenNotificationIds = Array.from(new Set([...(user.seenNotificationIds||[]), ...ids]));
  await saveDB();
}
function attachShellHandlers(){
  const mt = document.getElementById('menu-toggle');
  if(mt) mt.onclick = ()=>{ state.sidebarOpen = !state.sidebarOpen; render(); };
  const lo = document.getElementById('logout-btn');
  if(lo) lo.onclick = logout;
  document.querySelectorAll('[data-nav]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.nav;
      if(state.view==='admin') state.adminTab = key;
      if(state.view==='teacher') state.teacherTab = key;
      if(state.view==='student') state.studentTab = key;
      state.sidebarOpen = false;
      render();
    };
  });
  document.querySelectorAll('[data-open-account-modal]').forEach(btn=>btn.onclick=()=>openModal(btn.dataset.openAccountModal));
}

/* ======================= ADMIN ======================= */
function renderAdminMain(){
  const tab = state.adminTab;
  let body = '';
  if(tab==='overview') body = renderAdminOverview();
  else if(tab==='teachers') body = renderAdminTeachers();
  else if(tab==='students') body = renderAdminStudents();
  else if(tab==='classes') body = renderAdminClasses();
  else if(tab==='subjects') body = renderAdminSubjects();
  else if(tab==='evaluations') body = renderAdminEvaluations();
  else if(tab==='behavior') body = renderAdminBehavior();
  return `
  <div class="topbar">
    <div><h2>${titleFor(tab)}</h2><div class="desc">${descFor(tab)}</div></div>
  </div>
  ${body}`;
}
function titleFor(tab){
  return {overview:'Overview', teachers:'Teachers', students:'Students', classes:'Classes & Sections', subjects:'Subjects / Courses', evaluations:'Evaluations', behavior:'Behavior Log'}[tab];
}
function descFor(tab){
  return {
    overview:'Registrar snapshot of the school system.',
    teachers:'Create teacher accounts and assign the grade & section each one handles.',
    students:'Create student accounts and enroll them into a section.',
    classes:'Open grade levels and sections, and see who is assigned to each.',
    subjects:'Create the subjects or courses that teachers will teach and students will see.',
    evaluations:'Review grades and attendance across every class — useful for resolving disputes or errors.',
    behavior:'Positive, negative, and neutral conduct records logged by teachers across every section.',
  }[tab];
}
function renderAdminOverview(){
  const teacherCount = db.users.filter(u=>u.role==='teacher').length;
  const studentCount = db.users.filter(u=>u.role==='student').length;
  const classCount = db.classes.length;
  const materialCount = db.materials.length;
  const unassigned = db.classes.filter(c=>!c.teacherId).length;
  return `
  <div class="grid grid-3" style="margin-bottom:24px;">
    <div class="stat-card"><div class="num mono">${teacherCount}</div><div class="label">Teachers</div></div>
    <div class="stat-card"><div class="num mono">${studentCount}</div><div class="label">Students</div></div>
    <div class="stat-card"><div class="num mono">${classCount}</div><div class="label">Class Sections</div></div>
  </div>
  ${db.classes.length ? `<div class="card" style="margin-bottom:20px;">
    <div class="section-title">Enrollment per section</div>
    ${barChartHtml(db.classes.map(c=>({label:classLabel(c), value:studentsOfClass(c.id).length})))}
  </div>` : ''}
  <div class="card" style="margin-bottom:20px;">
    <div class="section-title">Class sections at a glance</div>
    <table>
      <thead><tr><th>Grade &amp; Section</th><th>Teacher assigned</th><th>Enrolled</th><th>Work posted</th></tr></thead>
      <tbody>
        ${db.classes.map(c=>{
          const t = getUser(c.teacherId);
          return `<tr>
            <td><b>${classLabel(c)}</b></td>
            <td>${t ? esc(t.name) : '<span class="pill pill-danger">Unassigned</span>'}</td>
            <td>${studentsOfClass(c.id).length}</td>
            <td>${materialsOfClass(c.id).length}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="4" class="empty">No class sections yet.</td></tr>`}
      </tbody>
    </table>
  </div>
  ${unassigned>0 ? `<div class="card" style="border-left:4px solid var(--danger);"><b style="color:var(--danger);">${unassigned} section(s)</b> have no teacher assigned yet — assign one under <i>Classes &amp; Sections</i>.</div>` : ''}
  `;
}
function renderAdminTeachers(){
  const teachers = db.users.filter(u=>u.role==='teacher');
  return `
  <div class="card">
    <div class="section-title">All teacher accounts <button class="btn btn-gold btn-sm" id="add-teacher-btn">+ New teacher account</button></div>
    <table>
      <thead><tr><th>Name</th><th>Username</th><th>Assigned sections</th><th></th></tr></thead>
      <tbody>
        ${teachers.map(t=>{
          const cls = classesOfTeacher(t.id);
          return `<tr>
            <td><b>${esc(t.name)}</b></td>
            <td class="mono">${esc(t.username)}</td>
            <td>${cls.length ? cls.map(c=>`<span class="pill pill-gold" style="margin-right:4px;">${classLabel(c)}</span>`).join('') : '<span class="pill pill-slate">None yet</span>'}</td>
            <td><button class="btn btn-ghost btn-sm" data-edit-user="${t.id}">Edit</button> <button class="btn btn-ghost btn-sm" data-remove-teacher="${t.id}">Remove</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="4" class="empty">No teacher accounts yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
function renderAdminStudents(){
  const students = db.users.filter(u=>u.role==='student');
  return `
  <div class="card">
    <div class="section-title">All student accounts <button class="btn btn-gold btn-sm" id="add-student-btn">+ New student account</button></div>
    <table>
      <thead><tr><th>Name</th><th>Username</th><th>LRN</th><th>Section</th><th></th></tr></thead>
      <tbody>
        ${students.map(s=>{
          const cls = getClass(s.classId);
          return `<tr>
            <td><b>${esc(s.name)}</b></td>
            <td class="mono">${esc(s.username)}</td>
            <td class="mono">${esc(s.lrn||'—')}</td>
            <td>${cls ? classLabel(cls) : '<span class="pill pill-danger">Not enrolled</span>'}</td>
            <td><button class="btn btn-ghost btn-sm" data-edit-user="${s.id}">Edit</button> <button class="btn btn-ghost btn-sm" data-remove-student="${s.id}">Remove</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="5" class="empty">No student accounts yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
function renderAdminClasses(){
  return `
  <div class="card">
    <div class="section-title">Grade levels &amp; sections <button class="btn btn-gold btn-sm" id="add-class-btn">+ New section</button></div>
    <table>
      <thead><tr><th>Grade &amp; Section</th><th>Class teacher</th><th>Subjects and teachers</th><th>Students</th><th></th></tr></thead>
      <tbody>
        ${db.classes.map(c=>{
          const t = getUser(c.teacherId);
          return `<tr>
            <td><b>${classLabel(c)}</b></td>
            <td>
              <select data-assign-class="${c.id}" style="width:auto; padding:6px 8px; font-size:0.82rem;">
                <option value="">— Unassigned —</option>
                ${db.users.filter(u=>u.role==='teacher').map(t2=>`<option value="${t2.id}" ${t2.id===c.teacherId?'selected':''}>${esc(t2.name)}</option>`).join('')}
              </select>
            </td>
            <td><div class="assignment-list">${subjectAssignmentsOfClass(c.id).map(cs=>{
              const subject = getSubject(cs.subjectId); const teacher = getUser(cs.teacherId);
              return `<div class="assignment-row"><span>${esc(subject.name)}</span><select data-assign-subject-teacher="${cs.id}"><option value="">— Teacher —</option>${db.users.filter(u=>u.role==='teacher').map(t2=>`<option value="${t2.id}" ${t2.id===cs.teacherId?'selected':''}>${esc(t2.name)}</option>`).join('')}</select></div>`;
            }).join('') || '<span class="helper">No subjects assigned</span>'}</div>
              <button class="btn btn-ghost btn-sm" data-assign-subject="${c.id}">+ Add subject</button></td>
            <td>${studentsOfClass(c.id).length}</td>
            <td><button class="btn btn-ghost btn-sm" data-remove-class="${c.id}">Remove</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="4" class="empty">No sections yet — add one to get started.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
function renderAdminSubjects(){
  return `<div class="card">
    <div class="section-title">Portal subjects and courses <button class="btn btn-gold btn-sm" id="add-subject-btn">+ New subject / course</button></div>
    <div class="helper" style="margin-bottom:14px;">Create the names teachers can teach and students can use to organize their work.</div>
    <table><thead><tr><th>Code</th><th>Subject / course name</th><th>Classes assigned</th><th></th></tr></thead>
    <tbody>${db.subjects.map(subject=>`<tr><td class="mono">${esc(subject.code||'—')}</td><td><b>${esc(subject.name)}</b></td><td>${db.classSubjects.filter(cs=>cs.subjectId===subject.id).length}</td><td><button class="btn btn-ghost btn-sm" data-remove-subject="${subject.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No subjects yet.</td></tr>'}</tbody></table>
  </div>`;
}
function renderAdminEvaluations(){
  const students = db.users.filter(u=>u.role==='student');
  const withGrades = students.filter(s=>studentAverage(s.id)!==null);
  const passingCt = withGrades.filter(s=>studentAverage(s.id)>=PASSING_THRESHOLD).length;
  const belowCt = withGrades.length - passingCt;
  return `
  ${withGrades.length ? `<div class="card" style="margin-bottom:18px;">
    <div class="section-title">Grade standing (school-wide)</div>
    ${barChartHtml([
      {label:`Passing (≥${PASSING_THRESHOLD}%)`, value:passingCt, color:'var(--success)'},
      {label:'Below passing', value:belowCt, color:'var(--danger)'},
    ])}
  </div>` : ''}
  <div class="card">
    <div class="section-title">Student evaluation records</div>
    <table>
      <thead><tr><th>Student</th><th>Section</th><th>Work graded</th><th>Average</th><th>Attendance (present)</th></tr></thead>
      <tbody>
        ${students.map(s=>{
          const cls = getClass(s.classId);
          const g = gradesOf(s.id);
          const avg = g.length ? Math.round(100*g.reduce((sum,x)=>sum+(x.score/x.maxScore),0)/g.length) : null;
          const att = attendanceOf(s.id, s.classId);
          const presentCt = att.filter(a=>a.status==='present').length;
          return `<tr>
            <td><b>${esc(s.name)}</b></td>
            <td>${cls?classLabel(cls):'—'}</td>
            <td>${g.length}</td>
            <td>${avg!==null ? `<span class="pill ${avg>=75?'pill-success':'pill-danger'}">${avg}%</span>` : '<span class="pill pill-slate">No data</span>'}</td>
            <td>${att.length ? `${presentCt}/${att.length}` : '—'}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="5" class="empty">No students enrolled yet.</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="card" style="margin-top:18px;">
    <div class="section-title">Teacher activity</div>
    <table>
      <thead><tr><th>Teacher</th><th>Sections handled</th><th>Work posted</th><th>Scores recorded</th></tr></thead>
      <tbody>
        ${db.users.filter(u=>u.role==='teacher').map(t=>{
          const cls = classesOfTeacher(t.id);
          const clsIds = cls.map(c=>c.id);
          const posted = db.materials.filter(m=>clsIds.includes(m.classId)).length;
          const scored = db.grades.filter(g=>clsIds.includes(g.classId)).length;
          return `<tr><td><b>${esc(t.name)}</b></td><td>${cls.length}</td><td>${posted}</td><td>${scored}</td></tr>`;
        }).join('') || `<tr><td colspan="4" class="empty">No teachers yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
function renderAdminBehavior(){
  const records = db.behavior.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="card">
    <div class="section-title">Behavioral records — all sections</div>
    <table><thead><tr><th>Date</th><th>Student</th><th>Section</th><th>Type</th><th>Category</th><th>Note</th><th>Recorded by</th></tr></thead>
    <tbody>${records.map(r=>{
      const s = getUser(r.studentId); const cls = getClass(r.classId); const t = getUser(r.recordedBy);
      return `<tr><td>${fmtDate(r.date)}</td><td><b>${esc(s?s.name:'—')}</b></td><td>${cls?classLabel(cls):'—'}</td><td>${behaviorPill(r.type)}</td><td>${esc(r.category||'—')}</td><td>${esc(r.note||'')}</td><td>${esc(t?t.name:'—')}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="empty">No behavioral records yet.</td></tr>`}</tbody></table>
  </div>`;
}
function attachAdminHandlers(){
  const at = document.getElementById('add-teacher-btn'); if(at) at.onclick = ()=>openModal('addTeacher');
  const as = document.getElementById('add-student-btn'); if(as) as.onclick = ()=>openModal('addStudent');
  const ac = document.getElementById('add-class-btn'); if(ac) ac.onclick = ()=>openModal('addClass');
  const addSubject = document.getElementById('add-subject-btn'); if(addSubject) addSubject.onclick = ()=>openModal('addSubject');
  document.querySelectorAll('[data-edit-user]').forEach(btn=>btn.onclick=()=>openModal('editUser', {userId:btn.dataset.editUser}));
  document.querySelectorAll('[data-remove-teacher]').forEach(b=>b.onclick=async ()=>{
    if(!confirm('Remove this teacher account? Their sections will become unassigned.')) return;
    const id = b.dataset.removeTeacher;
    db.classes.forEach(c=>{ if(c.teacherId===id) c.teacherId=''; });
    db.classSubjects.forEach(cs=>{ if(cs.teacherId===id) cs.teacherId=''; });
    db.users = db.users.filter(u=>u.id!==id);
    await saveDB(); showToast('Teacher account removed.'); render();
  });
  document.querySelectorAll('[data-remove-student]').forEach(b=>b.onclick=async ()=>{
    if(!confirm('Remove this student account? Their records will be deleted.')) return;
    const id = b.dataset.removeStudent;
    db.users = db.users.filter(u=>u.id!==id);
    db.grades = db.grades.filter(g=>g.studentId!==id);
    db.attendance.forEach(a=>{ delete a.records[id]; });
    db.behavior = db.behavior.filter(r=>r.studentId!==id);
    await saveDB(); showToast('Student account removed.'); render();
  });
  document.querySelectorAll('[data-remove-class]').forEach(b=>b.onclick=async ()=>{
    if(!confirm('Remove this section? Enrolled students will need reassignment.')) return;
    const id = b.dataset.removeClass;
    db.classes = db.classes.filter(c=>c.id!==id);
    db.users.forEach(u=>{ if(u.classId===id) u.classId=''; });
    await saveDB(); showToast('Section removed.'); render();
  });
  document.querySelectorAll('[data-assign-class]').forEach(sel=>sel.onchange=async ()=>{
    const cid = sel.dataset.assignClass;
    const c = getClass(cid); c.teacherId = sel.value;
    await saveDB(); showToast('Teacher assignment updated.'); render();
  });
  document.querySelectorAll('[data-assign-subject-teacher]').forEach(sel=>sel.onchange=async ()=>{
    const cs = getClassSubject(sel.dataset.assignSubjectTeacher);
    if(cs){ cs.teacherId = sel.value; await saveDB(); showToast('Subject teacher updated.'); render(); }
  });
  document.querySelectorAll('[data-assign-subject]').forEach(btn=>btn.onclick=()=>openModal('assignSubject', {classId:btn.dataset.assignSubject}));
  document.querySelectorAll('[data-remove-subject]').forEach(btn=>btn.onclick=async ()=>{
    if(!confirm('Remove this subject? Existing posted work will remain under Unassigned subject.')) return;
    const id = btn.dataset.removeSubject;
    db.subjects = db.subjects.filter(s=>s.id!==id);
    db.classSubjects = db.classSubjects.filter(cs=>cs.subjectId!==id);
    await saveDB(); showToast('Subject removed.'); render();
  });
}

/* ======================= TEACHER ======================= */
function renderTeacherMain(){
  const u = state.currentUser;
  const cls = classesOfTeacher(u.id);
  if(!cls.length && state.teacherTab!=='overview'){
    return `<div class="topbar"><div><h2>My Classes</h2><div class="desc">You have not been assigned a section yet.</div></div></div>
    <div class="card empty"><div class="glyph">📋</div>Once the admin assigns you a grade &amp; section, it will appear here.</div>`;
  }
  if(!cls.length){
    return `<div class="topbar"><div><h2>Overview</h2><div class="desc">Your teaching snapshot</div></div></div>${renderTeacherOverview([])}`;
  }
  if(!state.selectedClassId || !cls.find(c=>c.id===state.selectedClassId)) state.selectedClassId = cls[0].id;
  const activeCls = getClass(state.selectedClassId);
  const teacherSubjects = subjectAssignmentsOfClass(activeCls.id).filter(cs=>cs.teacherId===u.id);
  if(!state.selectedClassSubjectId || !teacherSubjects.find(cs=>cs.id===state.selectedClassSubjectId)) state.selectedClassSubjectId = teacherSubjects.length ? teacherSubjects[0].id : null;
  const tab = state.teacherTab;
  let body = '';
  if(tab==='overview') body = renderTeacherOverview(cls);
  else if(tab==='roster') body = renderTeacherRoster(activeCls);
  else if(tab==='post') body = renderTeacherPost(activeCls);
  else if(tab==='attendance') body = renderTeacherAttendance(activeCls);
  else if(tab==='gradebook') body = renderTeacherGradebook(activeCls);
  else if(tab==='behavior') body = renderTeacherBehavior(activeCls);

  return `
  <div class="topbar">
    <div><h2>${tabTitleTeacher(tab)}</h2><div class="desc">Handling ${classLabel(activeCls)}</div></div>
  </div>
  <div class="grid" style="grid-template-columns:repeat(${Math.min(cls.length,4)},1fr); margin-bottom:24px;">
    ${cls.map(c=>`<button class="class-chip ${c.id===state.selectedClassId?'active':''}" data-select-class="${c.id}">
      <div class="g">${esc(c.grade)}</div><div class="s">${esc(c.section)} · ${studentsOfClass(c.id).length} students</div>
    </button>`).join('')}
  </div>
  ${teacherSubjects.length ? `<div class="subject-tabs">${teacherSubjects.map(cs=>{ const subject=getSubject(cs.subjectId); return `<button class="tab-btn ${cs.id===state.selectedClassSubjectId?'active':''}" data-select-subject="${cs.id}">${esc(subject.name)}</button>`; }).join('')}</div>` : ''}
  ${body}`;
}
function tabTitleTeacher(tab){
  return {overview:'Overview', roster:'Class Roster', post:'Post Work', attendance:'Attendance', gradebook:'Gradebook', behavior:'Behavior'}[tab];
}
function renderTeacherOverview(classes){
  const teacherId = state.currentUser.id;
  const assignments = subjectAssignmentsOfTeacher(teacherId);
  const work = db.materials.filter(m=>assignments.some(cs=>cs.id===m.classSubjectId));
  const graded = db.grades.filter(g=>work.some(m=>m.id===g.materialId));
  return `<div class="grid grid-3" style="margin-bottom:24px;">
    <div class="stat-card"><div class="num mono">${classes.length}</div><div class="label">Classes</div></div>
    <div class="stat-card"><div class="num mono">${assignments.length}</div><div class="label">Subjects taught</div></div>
    <div class="stat-card"><div class="num mono">${work.length}</div><div class="label">Work posted</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card"><div class="section-title">My classes</div>${classes.length ? classes.map(cls=>`<button class="class-chip" data-select-class="${cls.id}"><div class="g">${esc(cls.grade)}</div><div class="s">${esc(cls.section)} · ${studentsOfClass(cls.id).length} students</div></button>`).join('') : '<div class="empty">No classes assigned yet.</div>'}</div>
    <div class="card"><div class="section-title">Subjects taught</div>${assignments.length ? assignments.map(cs=>{ const cls=getClass(cs.classId); const subject=getSubject(cs.subjectId); return `<div class="mat-item"><b>${esc(subject.name)}</b><div class="meta">${cls ? esc(classLabel(cls)) : 'Unknown class'} · ${materialsOfClassSubject(cs.id).length} work items</div></div>`; }).join('') : '<div class="empty">No subjects assigned yet.</div>'}</div>
  </div>
  <div class="card" style="margin-top:18px;"><div class="section-title">Grading snapshot</div><div class="desc">${graded.length} score${graded.length===1?'':'s'} recorded across your posted work.</div></div>`;
}
function renderTeacherRoster(cls){
  const students = studentsOfClass(cls.id);
  return `<div class="card">
    <div class="section-title">Roster — ${classLabel(cls)}</div>
    <table><thead><tr><th>Name</th><th>LRN</th><th>Username</th></tr></thead>
    <tbody>${students.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td class="mono">${esc(s.lrn||'—')}</td><td class="mono">${esc(s.username)}</td></tr>`).join('') || `<tr><td colspan="3" class="empty">No students enrolled in this section yet.</td></tr>`}</tbody></table>
  </div>`;
}
function renderTeacherPost(cls){
  const assignment = getClassSubject(state.selectedClassSubjectId);
  const subject = assignment ? getSubject(assignment.subjectId) : null;
  const mats = assignment ? materialsOfClassSubject(assignment.id) : [];
  return `
  <div class="card" style="margin-bottom:20px;">
    <div class="section-title">Post new work${subject ? ` for ${esc(subject.name)}` : ''} <button class="btn btn-gold btn-sm" id="post-work-btn" ${assignment?'':'disabled'}>+ New assignment / quiz / project</button></div>
    <div class="helper">${assignment ? "This will immediately appear in the class's Class Work list for students." : 'No subject is assigned to you for this class yet.'}</div>
  </div>
  <div class="section-title" style="margin-bottom:14px;">Posted to ${classLabel(cls)}${subject ? ` · ${esc(subject.name)}` : ''}</div>
  ${mats.length ? mats.map(m=>`
    <div class="mat-item">
      <div class="row1"><h4>${esc(m.title)}</h4>${typePill(m.type)}</div>
      <div class="meta">Posted ${fmtDate(m.postedAt)} ${m.dueDate?`· Due ${fmtDate(m.dueDate)}`:''}</div>
      <div class="desc">${esc(m.description)}</div>
      ${attachmentsHtml(m)}
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        ${m.allowOnlineSubmission ? `<button type="button" class="btn btn-gold btn-sm" data-view-submissions="${m.id}">View submissions (${submissionsOfMaterial(m.id).length}/${studentsOfClass(cls.id).length})</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-remove-mat="${m.id}">Remove</button>
      </div>
    </div>
  `).join('') : `<div class="card empty"><div class="glyph">🗂️</div>Nothing posted to this section yet.</div>`}
  `;
}
function renderTeacherAttendance(cls){
  const students = studentsOfClass(cls.id);
  const today = new Date().toISOString().slice(0,10);
  const existing = db.attendance.find(a=>a.classId===cls.id && a.classSubjectId===state.selectedClassSubjectId && a.date===today);
  const records = existing ? existing.records : {};
  return `
  <div class="card">
    <div class="section-title">Record attendance — <span class="mono" style="font-weight:600;">${fmtDate(today)}</span></div>
    ${students.length===0 ? `<div class="empty">No students enrolled in this section yet.</div>` : `
    <div class="att-grid" style="margin-bottom:6px;">
      <div class="att-head">Student</div><div class="att-head" style="text-align:center;">Present</div><div class="att-head" style="text-align:center;">Late</div><div class="att-head" style="text-align:center;">Absent</div>
    </div>
    ${students.map(s=>{
      const cur = records[s.id] || '';
      return `<div class="att-grid" style="margin-bottom:8px;" data-student-row="${s.id}">
        <div style="font-weight:600;">${esc(s.name)}</div>
        <button class="att-btn p ${cur==='present'?'sel':''}" data-att="${s.id}" data-status="present">✓</button>
        <button class="att-btn l ${cur==='late'?'sel':''}" data-att="${s.id}" data-status="late">L</button>
        <button class="att-btn a ${cur==='absent'?'sel':''}" data-att="${s.id}" data-status="absent">✕</button>
      </div>`;
    }).join('')}
    <div style="margin-top:16px;"><button class="btn btn-gold" id="save-attendance-btn">Save today's attendance</button></div>
    `}
  </div>
  <div class="card" style="margin-top:18px;">
    <div class="section-title">Recent attendance history</div>
    <table><thead><tr><th>Date</th><th>Present</th><th>Late</th><th>Absent</th></tr></thead>
    <tbody>${db.attendance.filter(a=>a.classId===cls.id && (!state.selectedClassSubjectId || a.classSubjectId===state.selectedClassSubjectId || !a.classSubjectId)).sort((a,b)=>b.date.localeCompare(a.date)).map(a=>{
      const vals = Object.values(a.records);
      return `<tr><td>${fmtDate(a.date)}</td><td>${vals.filter(v=>v==='present').length}</td><td>${vals.filter(v=>v==='late').length}</td><td>${vals.filter(v=>v==='absent').length}</td></tr>`;
    }).join('') || `<tr><td colspan="4" class="empty">No attendance recorded yet.</td></tr>`}</tbody></table>
  </div>`;
}
function renderTeacherBehavior(cls){
  const students = studentsOfClass(cls.id);
  const records = db.behavior.filter(b=>b.classId===cls.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="card" style="margin-bottom:20px;">
    <div class="section-title">Log behavior — ${classLabel(cls)} <button class="btn btn-gold btn-sm" id="add-behavior-btn" ${students.length?'':'disabled'}>+ New record</button></div>
    <div class="helper">${students.length ? 'Record positive, negative, or neutral conduct notes for a student in this section.' : 'No students enrolled in this section yet.'}</div>
  </div>
  <div class="card">
    <div class="section-title">Recent records</div>
    <table><thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Category</th><th>Note</th><th></th></tr></thead>
    <tbody>${records.map(r=>{
      const s = getUser(r.studentId);
      return `<tr><td>${fmtDate(r.date)}</td><td><b>${esc(s?s.name:'—')}</b></td><td>${behaviorPill(r.type)}</td><td>${esc(r.category||'—')}</td><td>${esc(r.note||'')}</td><td><button class="btn btn-ghost btn-sm" data-remove-behavior="${r.id}">Remove</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">No records yet for this section.</td></tr>`}</tbody></table>
  </div>`;
}
function renderTeacherGradebook(cls){
  const students = studentsOfClass(cls.id);
  const assignment = getClassSubject(state.selectedClassSubjectId);
  const subject = assignment ? getSubject(assignment.subjectId) : null;
  const mats = assignment ? materialsOfClassSubject(assignment.id).filter(m=>m.type!=='Handout') : [];
  const chartItems = mats.map(m=>{
    const scores = students.map(s=>db.grades.find(g=>g.studentId===s.id && g.materialId===m.id)).filter(Boolean);
    const avg = scores.length ? Math.round(100*scores.reduce((sum,g)=>sum+(g.score/g.maxScore),0)/scores.length) : 0;
    return {label:m.title, value:avg, suffix:'%'};
  });
  return `
  ${chartItems.length ? `<div class="card" style="margin-bottom:18px;">
    <div class="section-title">Class average per work item</div>
    ${barChartHtml(chartItems, {max:100, suffix:'%'})}
  </div>` : ''}
  <div class="card" style="overflow-x:auto;">
    <div class="section-title">Gradebook — ${classLabel(cls)}${subject ? ` · ${esc(subject.name)}` : ''}</div>
    ${students.length===0 || mats.length===0 ? `<div class="empty">${students.length===0?'No students enrolled yet.':'Post an assignment, quiz, or project first — grades appear once there is work to score.'}</div>` : `
    <table>
      <thead><tr><th>Student</th>${mats.map(m=>`<th>${esc(m.title)}<br><span style="font-weight:400; text-transform:none;">${esc(m.type)}</span></th>`).join('')}</tr></thead>
      <tbody>
        ${students.map(s=>`<tr><td><b>${esc(s.name)}</b></td>
          ${mats.map(m=>{
            const g = db.grades.find(x=>x.studentId===s.id && x.materialId===m.id);
            return `<td><input class="score-input" type="number" min="0" max="100" placeholder="—" value="${g?g.score:''}" data-grade-student="${s.id}" data-grade-mat="${m.id}"> / 10</td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:16px;"><button class="btn btn-gold" id="save-grades-btn">Save scores</button></div>
    `}
  </div>`;
}
function attachTeacherHandlers(){
  document.querySelectorAll('[data-select-class]').forEach(b=>b.onclick=()=>{ state.selectedClassId = b.dataset.selectClass; state.selectedClassSubjectId = null; state.teacherTab = 'roster'; render(); });
  document.querySelectorAll('[data-select-subject]').forEach(b=>b.onclick=()=>{ state.selectedClassSubjectId = b.dataset.selectSubject; render(); });
  const pw = document.getElementById('post-work-btn'); if(pw) pw.onclick=()=>openModal('postWork');
  const ab = document.getElementById('add-behavior-btn'); if(ab) ab.onclick=()=>openModal('addBehavior', {classId: state.selectedClassId});
  document.querySelectorAll('[data-remove-behavior]').forEach(b=>b.onclick=async ()=>{
    if(!confirm('Remove this behavioral record?')) return;
    db.behavior = db.behavior.filter(r=>r.id!==b.dataset.removeBehavior);
    await saveDB(); showToast('Record removed.'); render();
  });
  document.querySelectorAll('[data-view-submissions]').forEach(b=>b.onclick=()=>openModal('viewSubmissions', {materialId: b.dataset.viewSubmissions}));
  document.querySelectorAll('[data-remove-mat]').forEach(b=>b.onclick=async ()=>{
    if(!confirm('Remove this posted work? This also removes any student submissions and recorded scores for it.')) return;
    const matId = b.dataset.removeMat;
    db.materials = db.materials.filter(m=>m.id!==matId);
    db.submissions = db.submissions.filter(s=>s.materialId!==matId);
    db.grades = db.grades.filter(g=>g.materialId!==matId);
    await saveDB(); showToast('Removed.'); render();
  });
  document.querySelectorAll('[data-att]').forEach(b=>b.onclick=()=>{
    const sid = b.dataset.att, status = b.dataset.status;
    const row = document.querySelector(`[data-student-row="${sid}"]`);
    row.querySelectorAll('.att-btn').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    row.dataset.pending = status;
  });
  const sab = document.getElementById('save-attendance-btn');
  if(sab) sab.onclick = async ()=>{
    const cls = getClass(state.selectedClassId);
    const today = new Date().toISOString().slice(0,10);
    let rec = db.attendance.find(a=>a.classId===cls.id && a.classSubjectId===state.selectedClassSubjectId && a.date===today);
    if(!rec){ rec = { id: uid('a'), classId: cls.id, classSubjectId: state.selectedClassSubjectId, date: today, records:{} }; db.attendance.push(rec); }
    document.querySelectorAll('[data-student-row]').forEach(row=>{
      const sel = row.querySelector('.att-btn.sel');
      if(sel) rec.records[row.dataset.studentRow] = sel.dataset.status;
    });
    await saveDB(); showToast("Attendance saved."); render();
  };
  const sgb = document.getElementById('save-grades-btn');
  if(sgb) sgb.onclick = async ()=>{
    document.querySelectorAll('[data-grade-student]').forEach(inp=>{
      const sid = inp.dataset.gradeStudent, mid = inp.dataset.gradeMat;
      const val = inp.value;
      let g = db.grades.find(x=>x.studentId===sid && x.materialId===mid);
      if(val===''){ if(g) db.grades = db.grades.filter(x=>x!==g); return; }
      const score = Math.max(0, Math.min(10, Number(val)));
      if(!g){ g = { id: uid('g'), classId: state.selectedClassId, studentId: sid, materialId: mid, score, maxScore:10 }; db.grades.push(g); }
      else g.score = score;
    });
    await saveDB(); showToast("Scores saved."); render();
  };
}

/* ======================= STUDENT ======================= */
function renderStudentMain(){
  const u = state.currentUser;
  const cls = getClass(u.classId);
  if(!cls){
    return `<div class="topbar"><div><h2>Welcome, ${esc(u.name)}</h2><div class="desc">You are not yet enrolled in a section.</div></div></div>
    <div class="card empty"><div class="glyph">🎒</div>Ask the registrar's office to enroll you into a grade &amp; section.</div>`;
  }
  const tab = state.studentTab;
  let body='';
  if(tab==='overview') body = renderStudentOverview(cls);
  else if(tab==='grades') body = renderStudentGrades(cls);
  else if(tab==='subjects') body = renderStudentSubjects(cls);
  else if(tab==='work') body = renderStudentWork(cls);
  else if(tab==='behavior') body = renderStudentBehavior(cls);
  return `<div class="topbar"><div><h2>${tabTitleStudent(tab)}</h2><div class="desc">${classLabel(cls)}</div></div></div>${body}`;
}
function tabTitleStudent(tab){
  return {overview:'Overview', grades:'My Grades', subjects:'Subjects / Courses', work:'Class Work', behavior:'My Behavior'}[tab];
}
function renderStudentOverview(cls){
  const studentId = state.currentUser.id;
  const assignments = subjectAssignmentsOfClass(cls.id);
  const work = db.materials.filter(m=>m.classId===cls.id && m.type!=='Handout');
  const graded = gradesOf(studentId);
  const attendance = attendanceOf(studentId, cls.id);
  const pending = work.filter(m=>!graded.some(g=>g.materialId===m.id));
  const present = attendance.filter(a=>a.status==='present').length;
  const absent = attendance.filter(a=>a.status==='absent').length;
  return `<div class="grid grid-3" style="margin-bottom:24px;">
    <div class="stat-card"><div class="num mono">${assignments.length}</div><div class="label">Subjects</div></div>
    <div class="stat-card"><div class="num mono">${pending.length}</div><div class="label">Work to do</div></div>
    <div class="stat-card"><div class="num mono">${present}</div><div class="label">Days present</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card"><div class="section-title">My subjects</div>${assignments.length ? assignments.map(cs=>{ const subject=getSubject(cs.subjectId); const subjectWork=materialsOfClassSubject(cs.id).filter(m=>m.type!=='Handout'); return `<button class="class-chip" data-select-student-subject="${cs.id}"><div class="g">${esc(subject.name)}</div><div class="s">${subjectWork.length} work item${subjectWork.length===1?'':'s'}</div></button>`; }).join('') : '<div class="empty">No subjects assigned yet.</div>'}</div>
    <div class="card"><div class="section-title">Attendance snapshot</div><div class="grid grid-2"><div class="stat-card"><div class="num mono">${present}</div><div class="label">Present</div></div><div class="stat-card"><div class="num mono">${absent}</div><div class="label">Absent</div></div></div><button class="btn btn-gold" data-nav="subjects" style="margin-top:16px; width:100%;">View subjects &amp; attendance</button></div>
  </div>
  <div class="card" style="margin-top:18px;"><div class="section-title">Next work to do</div>${pending.length ? pending.slice().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,5).map(m=>`<div class="mat-item"><div class="row1"><h4>${esc(m.title)}</h4>${typePill(m.type)}</div><div class="meta">${m.dueDate ? `Due ${fmtDate(m.dueDate)}` : 'No due date'}</div></div>`).join('') : '<div class="empty">You are caught up on graded work.</div>'}</div>`;
}
function renderStudentGrades(cls){
  const u = state.currentUser;
  const g = gradesOf(u.id);
  const avg = g.length ? Math.round(100*g.reduce((s,x)=>s+(x.score/x.maxScore),0)/g.length) : null;
  const chartItems = g.map(x=>{ const m=db.materials.find(mm=>mm.id===x.materialId); return {label:m?m.title:'—', value:Math.round(100*x.score/x.maxScore), suffix:'%', color: (x.score/x.maxScore*100)>=PASSING_THRESHOLD?'var(--success)':'var(--danger)'}; });
  return `
  <div class="grid grid-3" style="margin-bottom:22px;">
    <div class="stat-card"><div class="num mono">${avg!==null?avg+'%':'—'}</div><div class="label">Overall average</div></div>
    <div class="stat-card"><div class="num mono">${g.length}</div><div class="label">Items graded</div></div>
    <div class="stat-card"><div class="num mono">${materialsOfClass(cls.id).filter(m=>m.type!=='Handout').length - g.length}</div><div class="label">Pending</div></div>
  </div>
  ${chartItems.length ? `<div class="card" style="margin-bottom:18px;">
    <div class="section-title">Scores by work item</div>
    ${barChartHtml(chartItems, {max:100, suffix:'%'})}
  </div>` : ''}
  <div class="card">
    <div class="section-title">Grade record</div>
    <table><thead><tr><th>Title</th><th>Type</th><th>Score</th></tr></thead>
    <tbody>${g.length ? g.map(x=>{
      const m = db.materials.find(mm=>mm.id===x.materialId);
      return `<tr><td><b>${esc(m?m.title:'—')}</b></td><td>${typePill(m?m.type:'')}</td><td class="mono">${x.score} / ${x.maxScore}</td></tr>`;
    }).join('') : `<tr><td colspan="3" class="empty">No grades recorded yet.</td></tr>`}</tbody></table>
  </div>`;
}
function renderStudentSubjects(cls){
  const assignments = subjectAssignmentsOfClass(cls.id);
  if(!assignments.length) return `<div class="card empty"><div class="glyph">📚</div>No subjects have been assigned to your section yet.</div>`;
  if(state.selectedStudentSubjectId && !assignments.some(cs=>cs.id===state.selectedStudentSubjectId)) state.selectedStudentSubjectId = null;
  const selected = assignments.find(cs=>cs.id===state.selectedStudentSubjectId) || assignments[0];
  state.selectedStudentSubjectId = selected.id;
  const subject = getSubject(selected.subjectId);
  const materials = materialsOfClassSubject(selected.id).sort((a,b)=>{
    if(!a.dueDate && b.dueDate) return 1;
    if(a.dueDate && !b.dueDate) return -1;
    return (a.dueDate||'').localeCompare(b.dueDate||'') || (b.postedAt||'').localeCompare(a.postedAt||'');
  });
  const attendance = attendanceOf(state.currentUser.id, cls.id, selected.id).sort((a,b)=>b.date.localeCompare(a.date));
  const present = attendance.filter(a=>a.status==='present').length;
  const absent = attendance.filter(a=>a.status==='absent').length;
  const late = attendance.filter(a=>a.status==='late').length;
  return `<div class="subject-tabs" style="margin-top:0;">${assignments.map(cs=>{ const item=getSubject(cs.subjectId); return `<button class="tab-btn ${cs.id===selected.id?'active':''}" data-select-student-subject="${cs.id}">${esc(item.name)}</button>`; }).join('')}</div>
  <div class="topbar" style="padding-top:0;"><div><h3>${esc(subject.name)}</h3><div class="desc">Assignments, quizzes, projects, handouts, and attendance</div></div></div>
  <div class="grid grid-3" style="margin-bottom:22px;">
    <div class="stat-card"><div class="num mono">${present}</div><div class="label">Present</div></div>
    <div class="stat-card"><div class="num mono">${late}</div><div class="label">Late</div></div>
    <div class="stat-card"><div class="num mono">${absent}</div><div class="label">Absent</div></div>
  </div>
  <div class="card" style="margin-bottom:18px;">
    <div class="section-title">Work to do</div>
    ${materials.length ? materials.map(m=>`<div class="mat-item"><div class="row1"><h4>${esc(m.title)}</h4>${typePill(m.type)}</div><div class="meta">Posted ${fmtDate(m.postedAt)} ${m.dueDate?`· Due ${fmtDate(m.dueDate)}`:'· No due date'}</div><div class="desc">${esc(m.description)}</div>${attachmentsHtml(m)}${submitWorkBlock(m)}</div>`).join('') : '<div class="empty">No assignments, quizzes, projects, or handouts yet.</div>'}
  </div>
  <div class="card">
    <div class="section-title">Attendance for ${esc(subject.name)}</div>
    <table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${attendance.length ? attendance.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.status==='present'?'<span class="pill pill-success">Present</span>':a.status==='late'?'<span class="pill pill-gold">Late</span>':a.status==='absent'?'<span class="pill pill-danger">Absent</span>':'<span class="pill pill-slate">—</span>'}</td></tr>`).join('') : '<tr><td colspan="2" class="empty">No attendance has been recorded yet.</td></tr>'}</tbody></table>
  </div>`;
}
function renderStudentAttendance(cls){
  const u = state.currentUser;
  const att = attendanceOf(u.id, cls.id).sort((a,b)=>b.date.localeCompare(a.date));
  const present = att.filter(a=>a.status==='present').length;
  const late = att.filter(a=>a.status==='late').length;
  const absent = att.filter(a=>a.status==='absent').length;
  return `
  <div class="grid grid-3" style="margin-bottom:22px;">
    <div class="stat-card"><div class="num mono">${present}</div><div class="label">Present</div></div>
    <div class="stat-card"><div class="num mono">${late}</div><div class="label">Late</div></div>
    <div class="stat-card"><div class="num mono">${absent}</div><div class="label">Absent</div></div>
  </div>
  ${att.length ? `<div class="card" style="margin-bottom:18px;">
    <div class="section-title">Attendance breakdown</div>
    ${barChartHtml([
      {label:'Present', value:present, color:'var(--success)'},
      {label:'Late', value:late, color:'#C79A3D'},
      {label:'Absent', value:absent, color:'var(--danger)'},
    ])}
  </div>` : ''}
  <div class="card">
    <div class="section-title">Attendance log</div>
    <table><thead><tr><th>Date</th><th>Status</th></tr></thead>
    <tbody>${att.length ? att.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${
      a.status==='present'?'<span class="pill pill-success">Present</span>':
      a.status==='late'?'<span class="pill pill-gold">Late</span>':
      a.status==='absent'?'<span class="pill pill-danger">Absent</span>':'<span class="pill pill-slate">—</span>'
    }</td></tr>`).join('') : `<tr><td colspan="2" class="empty">No attendance recorded yet.</td></tr>`}</tbody></table>
  </div>`;
}
function renderStudentWork(cls){
  const assignments = subjectAssignmentsOfClass(cls.id);
  if(state.selectedStudentSubjectId && !assignments.some(cs=>cs.id===state.selectedStudentSubjectId)) state.selectedStudentSubjectId = null;
  const groups = assignments.map(cs=>({ assignment:cs, subject:getSubject(cs.subjectId), materials:materialsOfClassSubject(cs.id) }))
    .concat([{assignment:null, subject:null, materials:materialsOfClass(cls.id).filter(m=>!m.classSubjectId)}])
    .filter(group=>!state.selectedStudentSubjectId || group.assignment && group.assignment.id===state.selectedStudentSubjectId);
  const work = groups.filter(group=>group.materials.length).map(group=>`
    <div class="card" style="margin-bottom:18px;">
      <div class="section-title">${group.subject ? esc(group.subject.name) : 'Unassigned subject'}</div>
      ${group.materials.sort((a,b)=>{
        if(!a.dueDate && b.dueDate) return 1;
        if(a.dueDate && !b.dueDate) return -1;
        return (a.dueDate||'').localeCompare(b.dueDate||'') || (b.postedAt||'').localeCompare(a.postedAt||'');
      }).map(m=>`<div class="mat-item">
        <div class="row1"><h4>${esc(m.title)}</h4>${typePill(m.type)}</div>
        <div class="meta">Posted ${fmtDate(m.postedAt)} ${m.dueDate?`· Due ${fmtDate(m.dueDate)}`:'· No due date'}</div>
        <div class="desc">${esc(m.description)}</div>
        ${attachmentsHtml(m)}
        ${submitWorkBlock(m)}
      </div>`).join('')}
    </div>`).join('');
  const subjectTabs = assignments.length ? `<div class="subject-tabs"><button class="tab-btn ${!state.selectedStudentSubjectId?'active':''}" data-select-work-subject="">All subjects</button>${assignments.map(cs=>{ const subject=getSubject(cs.subjectId); return `<button class="tab-btn ${cs.id===state.selectedStudentSubjectId?'active':''}" data-select-work-subject="${cs.id}">${esc(subject.name)}</button>`; }).join('')}</div>` : '';
  return subjectTabs + (work || `<div class="card empty"><div class="glyph">📚</div>Your teachers haven't posted any work yet.</div>`);
}
function renderStudentBehavior(cls){
  const records = behaviorOf(state.currentUser.id);
  const pos = records.filter(r=>r.type==='Positive').length;
  const neg = records.filter(r=>r.type==='Negative').length;
  return `<div class="grid grid-3" style="margin-bottom:22px;">
    <div class="stat-card"><div class="num mono">${pos}</div><div class="label">Positive notes</div></div>
    <div class="stat-card"><div class="num mono">${neg}</div><div class="label">Negative notes</div></div>
    <div class="stat-card"><div class="num mono">${records.length}</div><div class="label">Total records</div></div>
  </div>
  <div class="card">
    <div class="section-title">Behavior log</div>
    <table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th></tr></thead>
    <tbody>${records.map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${behaviorPill(r.type)}</td><td>${esc(r.category||'—')}</td><td>${esc(r.note||'')}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">No records yet.</td></tr>`}</tbody></table>
  </div>`;
}
function attachStudentHandlers(){
  document.querySelectorAll('[data-select-student-subject]').forEach(btn=>btn.onclick=()=>{ state.selectedStudentSubjectId = btn.dataset.selectStudentSubject || null; state.studentTab = 'subjects'; render(); });
  document.querySelectorAll('[data-select-work-subject]').forEach(btn=>btn.onclick=()=>{ state.selectedStudentSubjectId = btn.dataset.selectWorkSubject || null; state.studentTab = 'work'; render(); });
  document.querySelectorAll('[data-submit-work]').forEach(btn=>btn.onclick=()=>openModal('submitWork', {materialId: btn.dataset.submitWork}));
}

/* ======================= MODALS ======================= */
async function openModal(type, payload){
  if(type==='notifications') await markNotificationsRead();
  if(type==='messages' && !payload) payload = {view:'list'};
  state.modal = {type, payload};
  render();
}
function closeModal(){
  state.modal = null;
  const existingModal = document.getElementById('modal-bg');
  if(existingModal) existingModal.remove();
  render();
}
function renderModal(){
  const existingModal = document.getElementById('modal-bg');
  if(existingModal) existingModal.remove();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.id = 'modal-bg';
  const t = state.modal.type;
  let inner = '';
  if(t==='addTeacher') inner = modalAddTeacher();
  else if(t==='addStudent') inner = modalAddStudent();
  else if(t==='addClass') inner = modalAddClass();
  else if(t==='addSubject') inner = modalAddSubject();
  else if(t==='assignSubject') inner = modalAssignSubject(state.modal.payload.classId);
  else if(t==='postWork') inner = modalPostWork();
  else if(t==='submitWork') inner = modalSubmitWork(state.modal.payload.materialId);
  else if(t==='viewSubmissions') inner = modalViewSubmissions(state.modal.payload.materialId);
  else if(t==='editUser') inner = modalEditUser(state.modal.payload.userId);
  else if(t==='addBehavior') inner = modalAddBehavior(state.modal.payload.classId);
  else if(t==='notifications') inner = modalNotifications();
  else if(t==='messages') inner = modalMessagesEnhanced();
  else if(t==='profile') inner = modalProfileEnhanced();
  else if(t==='settings') inner = modalSettings();
  bg.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(bg);
  if(t==='editUser'){
    const lrnInput = document.getElementById('f-lrn');
    if(lrnInput){
      lrnInput.readOnly = true;
      if(!lrnInput.value) lrnInput.value = 'Generated automatically';
      const label = lrnInput.closest('.field')?.querySelector('label');
      if(label) label.textContent = 'LRN';
      if(!lrnInput.nextElementSibling || !lrnInput.nextElementSibling.classList.contains('helper')){
        lrnInput.insertAdjacentHTML('afterend', '<div class="helper">The system assigns this number automatically.</div>');
      }
    }
  }
  bg.addEventListener('click', (e)=>{ if(e.target===bg) closeModal(); });
  attachModalHandlers(t);
}
function modalAddTeacher(){
  return `<h3>New teacher account</h3>
  <form id="modal-form">
    <div class="field"><label>Full name</label><input type="text" id="f-name" required></div>
    <div class="field"><label>School email</label><input type="email" id="f-email" placeholder="teacher@flc.edu" required></div>
    <div class="field"><label>Username</label><input type="text" id="f-username" required></div>
    <div class="field"><label>Temporary password</label><input type="text" id="f-password" required></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Create account</button></div>
  </form>`;
}
function modalEditUser(userId){
  const user = getUser(userId);
  if(!user) return '<h3>Account unavailable</h3><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button>';
  return `<h3>Edit ${user.role} account</h3>
  <form id="modal-form">
    <input type="hidden" id="f-user-id" value="${esc(user.id)}">
    <div class="field"><label>Full name</label><input type="text" id="f-name" value="${esc(user.name)}" required></div>
    <div class="field"><label>School email</label><input type="email" id="f-email" value="${esc(user.email||'')}" required></div>
    <div class="field"><label>Username</label><input type="text" id="f-username" value="${esc(user.username)}" required></div>
    ${user.role==='student' ? `<div class="field"><label>LRN</label><input type="text" id="f-lrn" value="${esc(user.lrn||'Generated automatically')}" readonly><div class="helper">The system assigns this number automatically.</div></div><div class="field"><label>Enroll in section</label><select id="f-class"><option value="">— Not yet enrolled —</option>${db.classes.map(c=>`<option value="${c.id}" ${c.id===user.classId?'selected':''}>${esc(classLabel(c))}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>New password (optional)</label><input type="text" id="f-password" placeholder="Leave blank to keep current password"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Save changes</button></div>
  </form>`;
}
function modalAddBehavior(classId){
  const students = studentsOfClass(classId);
  const today = new Date().toISOString().slice(0,10);
  return `<h3>New behavior record</h3>
  <form id="modal-form">
    <div class="field"><label>Student</label><select id="f-behavior-student" required>${students.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Type</label><select id="f-behavior-type">${BEHAVIOR_TYPES.map(t=>`<option>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Category</label><input type="text" id="f-behavior-category" placeholder="e.g. Participation, Tardiness, Conduct"></div>
    <div class="field"><label>Note</label><textarea id="f-behavior-note" placeholder="Describe what happened"></textarea></div>
    <div class="field"><label>Date</label><input type="date" id="f-behavior-date" value="${today}"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Save record</button></div>
  </form>`;
}
function modalNotifications(){
  const items = notificationsForUser(state.currentUser, state.view);
  return `<h3>Notifications</h3>${items.length ? items.map(item=>`<div class="notification-item"><b>${esc(item.title)}</b><div>${esc(item.body)}</div></div>`).join('') : '<div class="empty">You have no new notifications.</div>'}<div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function modalMessages(){
  return `<h3>Messages</h3><div class="empty"><div class="glyph">&#128172;</div>No messages yet.</div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function modalProfile(){
  const user = state.currentUser;
  return `<h3>Profile</h3><div class="profile-modal"><span class="avatar avatar-large">${esc(initials(user.name))}</span><b>${esc(user.name)}</b><span class="meta">${esc(user.email||user.username)} · ${esc(user.role)}</span></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function modalSettings(){
  const user = state.currentUser;
  return `<h3>Account settings</h3><form id="modal-form"><div class="field"><label>Display name</label><input type="text" id="f-settings-name" value="${esc(user.name)}" required></div><div class="field"><label>School email</label><input type="email" id="f-settings-email" value="${esc(user.email||'')}" required></div><div class="field"><label>New password (optional)</label><input type="text" id="f-settings-password" placeholder="Leave blank to keep current password"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Save settings</button></div></form>`;
}
function conversationPartners(){
  const user = state.currentUser;
  const ids = new Set();
  db.messages.forEach(m=>{
    if(m.fromId===user.id) ids.add(m.toId);
    else if(m.toId===user.id) ids.add(m.fromId);
  });
  return Array.from(ids).map(id=>{
    const msgs = db.messages.filter(m=>(m.fromId===user.id&&m.toId===id)||(m.fromId===id&&m.toId===user.id)).sort((a,b)=>(a.sentAt||'').localeCompare(b.sentAt||''));
    return { user:getUser(id), last: msgs[msgs.length-1] };
  }).filter(c=>c.user && c.last).sort((a,b)=>(b.last.sentAt||'').localeCompare(a.last.sentAt||''));
}
function messageAttachmentHtml(m){
  if(!m.attachment || !m.attachment.dataUrl) return '';
  return `<a class="attachment-chip" href="${esc(m.attachment.dataUrl)}" download="${esc(m.attachment.name)}">📎 ${esc(m.attachment.name)}${m.attachment.size!==undefined?` <span>(${fmtFileSize(m.attachment.size)})</span>`:''}</a>`;
}
function modalMessagesEnhanced(){
  const payload = state.modal.payload || {view:'list'};
  if(payload.view==='compose') return modalMessagesCompose(payload);
  if(payload.view==='thread') return modalMessagesThread(payload.otherId);
  return modalMessagesList();
}
function modalMessagesList(){
  const convos = conversationPartners();
  const user = state.currentUser;
  return `<h3 style="display:flex; align-items:center; justify-content:space-between; gap:10px;">Messages <button type="button" class="btn btn-gold btn-sm" id="new-message-btn">+ New message</button></h3>
  <div class="message-list">
    ${convos.length ? convos.map(c=>`<button type="button" class="message-item conversation-row" data-open-thread="${c.user.id}">
      <div class="row1"><b>${esc(c.user.name)}</b><span>${fmtDate((c.last.sentAt||'').slice(0,10))}</span></div>
      <div class="meta">${esc(c.user.role)}</div>
      <div>${esc((c.last.fromId===user.id?'You: ':'') + (c.last.body || (c.last.attachment ? '📎 ' + c.last.attachment.name : '')).slice(0,80))}</div>
    </button>`).join('') : '<div class="empty"><div class="glyph">&#128172;</div>No conversations yet — start one.</div>'}
  </div>
  <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function modalMessagesCompose(payload){
  const search = payload.search || '';
  const recipient = payload.recipientId ? getUser(payload.recipientId) : null;
  const candidates = (search && !recipient) ? db.users.filter(u=>u.id!==state.currentUser.id && u.name.toLowerCase().includes(search.toLowerCase())).slice(0,6) : [];
  return `<h3><button type="button" class="icon-btn" id="back-to-list" title="Back">&larr;</button> New message</h3>
  <form id="modal-form">
    <div class="field">
      <label>To</label>
      ${recipient
        ? `<div class="attachment-chip" style="width:fit-content;">${esc(recipient.name)} <span>(${esc(recipient.role)})</span> <span style="cursor:pointer; margin-left:6px;" id="clear-recipient" title="Change recipient">&times;</span></div>`
        : `<input type="text" id="f-message-to-search" placeholder="Type a name…" value="${esc(search)}" autocomplete="off">
           <div id="recipient-suggestions">${candidates.map(u=>`<div class="notification-item" data-pick-recipient="${u.id}"><b>${esc(u.name)}</b> <span class="meta">${esc(u.role)}</span></div>`).join('')}</div>`}
    </div>
    <div class="field"><label>Message</label><textarea id="f-message-body" ${recipient?'required':''}></textarea></div>
    <div class="field"><label>Attach a file (optional)</label><input type="file" id="f-message-file"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold" ${recipient?'':'disabled'}>Send</button></div>
  </form>`;
}
function modalMessagesThread(otherId){
  const other = getUser(otherId);
  if(!other) return modalMessagesList();
  const user = state.currentUser;
  const msgs = db.messages.filter(m=>(m.fromId===user.id&&m.toId===otherId)||(m.fromId===otherId&&m.toId===user.id)).sort((a,b)=>(a.sentAt||'').localeCompare(b.sentAt||''));
  return `<h3><button type="button" class="icon-btn" id="back-to-list" title="Back">&larr;</button> ${esc(other.name)} <span class="meta">(${esc(other.role)})</span></h3>
  <div class="chat-thread">
    ${msgs.length ? msgs.map(m=>`<div class="chat-bubble ${m.fromId===user.id?'mine':'theirs'}">
      ${m.body?`<div>${esc(m.body)}</div>`:''}
      ${messageAttachmentHtml(m)}
      <div class="chat-time">${fmtDate((m.sentAt||'').slice(0,10))}</div>
    </div>`).join('') : '<div class="empty">No messages yet — say hello.</div>'}
  </div>
  <form id="modal-form" class="chat-input-row">
    <textarea id="f-message-body" placeholder="Type a reply…"></textarea>
    <input type="file" id="f-message-file" title="Attach a file">
    <button type="submit" class="btn btn-gold btn-sm">Send</button>
  </form>
  <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function modalProfileEnhanced(){
  const user = state.currentUser;
  return `<h3>Profile</h3>
  <form id="modal-form">
    <div class="profile-modal">${userAvatar(user, 'avatar-large')}<b>${esc(user.name)}</b><span class="meta">${esc(user.email||user.username)} - ${esc(user.role)}</span></div>
    <div class="field"><label>Display name</label><input type="text" id="f-profile-name" value="${esc(user.name)}" required></div>
    <div class="field"><label>School email</label><input type="email" id="f-profile-email" value="${esc(user.email||'')}" required></div>
    <div class="field"><label>Profile picture</label><input type="file" id="f-profile-photo" accept="image/*"><div class="helper">Choose a photo from your computer, then save profile.</div></div>
    ${user.photoDataUrl ? '<label class="check-row"><input type="checkbox" id="f-profile-remove-photo"> Remove current picture</label>' : ''}
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Save profile</button></div>
  </form>`;
}
function modalAddStudent(){
  return `<h3>New student account</h3>
  <form id="modal-form">
    <div class="field"><label>Full name</label><input type="text" id="f-name" required></div>
    <div class="field"><label>School email</label><input type="email" id="f-email" placeholder="student@flc.edu" required></div>
    <div class="field"><label>LRN</label><input type="text" value="Generated automatically" readonly><div class="helper">A unique 12-digit LRN will be assigned when the account is created.</div></div>
    <div class="field"><label>Username</label><input type="text" id="f-username" required></div>
    <div class="field"><label>Temporary password</label><input type="text" id="f-password" required></div>
    <div class="field"><label>Enroll in section</label>
      <select id="f-class"><option value="">— Not yet enrolled —</option>${db.classes.map(c=>`<option value="${c.id}">${classLabel(c)}</option>`).join('')}</select>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Create account</button></div>
  </form>`;
}
function modalAddClass(){
  return `<h3>New grade &amp; section</h3>
  <form id="modal-form">
    <div class="field"><label>Grade level</label><input type="text" id="f-grade" placeholder="e.g. Grade 1" required></div>
    <div class="field"><label>Section name</label><input type="text" id="f-section" placeholder="e.g. Section 1 - Faith" required></div>
    <div class="field"><label>Assign teacher (optional)</label>
      <select id="f-teacher"><option value="">— Unassigned —</option>${db.users.filter(u=>u.role==='teacher').map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Create section</button></div>
  </form>`;
}
function modalAddSubject(){
  return `<h3>New subject / course</h3>
  <form id="modal-form">
    <div class="field"><label>Subject or course name</label><input type="text" id="f-subject-name" placeholder="e.g. English" required></div>
    <div class="field"><label>Short code (optional)</label><input type="text" id="f-subject-code" placeholder="e.g. ENG" maxlength="12"></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Create subject</button></div>
  </form>`;
}
function modalAssignSubject(classId){
  const assigned = new Set(subjectAssignmentsOfClass(classId).map(cs=>cs.subjectId));
  return `<h3>Assign subject to class</h3>
  <form id="modal-form">
    <div class="field"><label>Subject / course</label><select id="f-subject" required><option value="">— Choose subject —</option>${db.subjects.filter(s=>!assigned.has(s.id)).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Teacher</label><select id="f-subject-teacher"><option value="">— Unassigned —</option>${db.users.filter(u=>u.role==='teacher').map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold">Assign subject</button></div>
  </form>`;
}
function modalPostWork(){
  return `<h3>Post new work</h3>
  <form id="modal-form">
    <div class="field"><label>Subject / course</label><select id="f-class-subject" required>${subjectAssignmentsOfClass(state.selectedClassId).filter(cs=>cs.teacherId===state.currentUser.id).map(cs=>{ const subject=getSubject(cs.subjectId); return `<option value="${cs.id}" ${cs.id===state.selectedClassSubjectId?'selected':''}>${esc(subject.name)}</option>`; }).join('')}</select></div>
    <div class="field"><label>Type</label>
      <select id="f-type"><option>Assignment</option><option>Quiz</option><option>Project</option><option>Handout</option></select>
    </div>
    <div class="field"><label>Title</label><input type="text" id="f-title" required></div>
    <div class="field"><label>Instructions / description</label><textarea id="f-desc"></textarea></div>
    <div class="field"><label>Due date (optional)</label><input type="date" id="f-due"></div>
    <div class="field"><label>Attach files (optional)</label><input type="file" id="f-files" multiple><div class="helper">Attach handouts, worksheets, or references (roughly 4MB total).</div></div>
    <div class="field"><label class="check-row"><input type="checkbox" id="f-allow-submit"> Allow students to submit their work online</label></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold" id="post-work-submit">Post to class</button></div>
  </form>`;
}
function modalSubmitWork(materialId){
  const material = db.materials.find(m=>m.id===materialId);
  if(!material) return '<h3>Work unavailable</h3><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button>';
  const existing = submissionFor(materialId, state.currentUser.id);
  return `<h3>Submit — ${esc(material.title)}</h3>
  <div class="helper" style="margin-bottom:14px;">${material.dueDate ? `Due ${fmtDate(material.dueDate)}` : 'No due date set.'}</div>
  <form id="modal-form">
    <div class="field"><label>Notes / answer (optional)</label><textarea id="f-submit-text">${esc(existing ? (existing.textAnswer||'') : '')}</textarea></div>
    <div class="field"><label>Attach your file${existing && existing.fileName ? ' (optional — replaces current file)' : ' (optional)'}</label><input type="file" id="f-submit-file"><div class="helper">${existing && existing.fileName ? `Currently attached: ${esc(existing.fileName)}.` : 'Roughly 4MB max.'}</div></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button><button type="submit" class="btn btn-gold" id="submit-work-submit">${existing ? 'Update submission' : 'Submit'}</button></div>
  </form>`;
}
function modalViewSubmissions(materialId){
  const material = db.materials.find(m=>m.id===materialId);
  if(!material) return '<h3>Work unavailable</h3><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button>';
  const cls = getClass(material.classId);
  const students = cls ? studentsOfClass(cls.id) : [];
  const rows = students.map(s=>{
    const sub = submissionFor(materialId, s.id);
    const grade = db.grades.find(g=>g.studentId===s.id && g.materialId===materialId);
    return `<div class="mat-item" data-sub-row="${s.id}">
      <div class="row1"><h4>${esc(s.name)}</h4>${sub ? '<span class="pill pill-success">Submitted</span>' : '<span class="pill pill-slate">Not submitted</span>'}</div>
      ${sub ? `
        <div class="meta">Submitted ${fmtDate((sub.submittedAt||'').slice(0,10))}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-toggle-answer="${s.id}">View answer</button>
        <div class="desc" style="display:none; margin-top:10px;" id="answer-${s.id}">
          ${sub.textAnswer ? `<div style="margin-bottom:8px; white-space:pre-wrap;">${esc(sub.textAnswer)}</div>` : ''}
          ${sub.fileName ? `<a class="attachment-chip" href="${esc(sub.fileDataUrl)}" download="${esc(sub.fileName)}">📎 ${esc(sub.fileName)}${sub.fileSize!==undefined?` <span>(${fmtFileSize(sub.fileSize)})</span>`:''}</a>` : ''}
          ${!sub.textAnswer && !sub.fileName ? '<div class="empty">No answer content.</div>' : ''}
        </div>
        <div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <input class="score-input" type="number" min="0" max="10" placeholder="—" value="${grade?grade.score:''}" data-submission-score="${s.id}"> / 10
          <button type="button" class="btn btn-gold btn-sm" data-record-score="${s.id}">Record</button>
          ${grade ? '<span class="pill pill-success">Recorded to gradebook</span>' : ''}
        </div>
      ` : `<div class="meta">Waiting for the student to submit.</div>`}
    </div>`;
  }).join('');
  return `<h3>Submissions — ${esc(material.title)}</h3>${rows || '<div class="empty">No students enrolled in this section yet.</div>'}<div class="modal-actions"><button type="button" class="btn btn-ghost" id="modal-cancel">Close</button></div>`;
}
function readFileAsDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = ()=>reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function attachMessagesModalHandlers(){
  if(!state.modal.payload) state.modal.payload = {view:'list'};
  document.querySelectorAll('[data-open-thread]').forEach(btn=>btn.onclick=()=>{ state.modal.payload = {view:'thread', otherId: btn.dataset.openThread}; renderModal(); });
  const nb = document.getElementById('new-message-btn'); if(nb) nb.onclick = ()=>{ state.modal.payload = {view:'compose', search:'', recipientId:null}; renderModal(); };
  const back = document.getElementById('back-to-list'); if(back) back.onclick = ()=>{ state.modal.payload = {view:'list'}; renderModal(); };
  const clearR = document.getElementById('clear-recipient'); if(clearR) clearR.onclick = ()=>{ state.modal.payload.recipientId = null; renderModal(); };
  const wireSuggestions = ()=>{
    document.querySelectorAll('[data-pick-recipient]').forEach(el=>el.onclick=()=>{ state.modal.payload.recipientId = el.dataset.pickRecipient; renderModal(); });
  };
  wireSuggestions();
  const searchInput = document.getElementById('f-message-to-search');
  if(searchInput){
    searchInput.focus();
    const pos = searchInput.value.length;
    searchInput.setSelectionRange(pos, pos);
    searchInput.oninput = ()=>{
      const val = searchInput.value;
      state.modal.payload.search = val;
      const box = document.getElementById('recipient-suggestions');
      if(box){
        const candidates = val ? db.users.filter(u=>u.id!==state.currentUser.id && u.name.toLowerCase().includes(val.toLowerCase())).slice(0,6) : [];
        box.innerHTML = candidates.map(u=>`<div class="notification-item" data-pick-recipient="${u.id}"><b>${esc(u.name)}</b> <span class="meta">${esc(u.role)}</span></div>`).join('');
        wireSuggestions();
      }
    };
  }
  const thread = document.querySelector('.chat-thread');
  if(thread) thread.scrollTop = thread.scrollHeight;
}
function attachModalHandlers(type){
  const cancel = document.getElementById('modal-cancel'); if(cancel) cancel.onclick = closeModal;
  if(type==='messages') attachMessagesModalHandlers();
  if(type==='viewSubmissions'){
    document.querySelectorAll('[data-toggle-answer]').forEach(btn=>{
      btn.onclick = ()=>{
        const el = document.getElementById('answer-'+btn.dataset.toggleAnswer);
        if(el) el.style.display = (el.style.display==='none' || !el.style.display) ? 'block' : 'none';
      };
    });
    document.querySelectorAll('[data-record-score]').forEach(btn=>{
      btn.onclick = async ()=>{
        const sid = btn.dataset.recordScore;
        const materialId = state.modal.payload.materialId;
        const input = document.querySelector(`[data-submission-score="${sid}"]`);
        const val = input ? input.value : '';
        if(val===''){ alert('Enter a score first.'); return; }
        const score = Math.max(0, Math.min(10, Number(val)));
        const material = db.materials.find(m=>m.id===materialId);
        if(!material) return;
        let g = db.grades.find(x=>x.studentId===sid && x.materialId===materialId);
        if(!g){ g = { id: uid('g'), classId: material.classId, studentId: sid, materialId, score, maxScore:10 }; db.grades.push(g); }
        else g.score = score;
        await saveDB();
        showToast('Score recorded to gradebook.');
        renderModal();
      };
    });
    return;
  }
  const form = document.getElementById('modal-form');
  if(!form) return;
  form.onsubmit = async (e)=>{
    e.preventDefault();
    if(type==='editUser'){
      const user = getUser(document.getElementById('f-user-id').value);
      if(!user) return;
      const name = document.getElementById('f-name').value.trim();
      const email = document.getElementById('f-email').value.trim().toLowerCase();
      const username = document.getElementById('f-username').value.trim();
      const duplicate = db.users.some(other=>other.id!==user.id && (other.username.toLowerCase()===username.toLowerCase() || (other.email||'').toLowerCase()===email));
      if(duplicate){ alert('That username or email is already taken.'); return; }
      user.name = name; user.email = email; user.username = username;
      if(user.role==='student'){
        user.lrn = user.lrn || generateUniqueLrn(user.id);
        user.classId = document.getElementById('f-class').value;
      }
      const password = document.getElementById('f-password').value;
      if(password) user.password = password;
      await saveDB(); closeModal(); showToast('Account updated.');
    } else if(type==='settings'){
      const user = state.currentUser;
      const email = document.getElementById('f-settings-email').value.trim().toLowerCase();
      const duplicate = db.users.some(other=>other.id!==user.id && (other.email||'').toLowerCase()===email);
      if(duplicate){ alert('That email is already taken.'); return; }
      user.name = document.getElementById('f-settings-name').value.trim();
      user.email = email;
      const password = document.getElementById('f-settings-password').value;
      if(password) user.password = password;
      await saveDB(); closeModal(); showToast('Settings updated.');
    } else if(type==='messages'){
      const payload = state.modal.payload;
      const toId = payload.view==='compose' ? payload.recipientId : payload.otherId;
      const bodyInput = document.getElementById('f-message-body');
      const body = bodyInput ? bodyInput.value.trim() : '';
      const fileInput = document.getElementById('f-message-file');
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      if(!toId){ alert('Choose a recipient first.'); return; }
      if(!body && !file){ alert('Write a message or attach a file.'); return; }
      if(file && file.size > 4 * 1024 * 1024){ alert('That file is too large (about ' + fmtFileSize(file.size) + '). Please keep it under ~4MB.'); return; }
      let attachment = null;
      if(file){
        try{ attachment = { name:file.name, size:file.size, mimeType:file.type, dataUrl: await readFileAsDataUrl(file) }; }
        catch(err){ console.error('message attachment read failed', err); alert('That file could not be read. Please try again.'); return; }
      }
      db.messages.push({ id:uid('msg'), fromId:state.currentUser.id, toId, body, attachment, sentAt:new Date().toISOString() });
      await saveDB();
      showToast('Message sent.');
      state.modal.payload = { view:'thread', otherId: toId };
      renderModal();
    } else if(type==='profile'){
      const user = state.currentUser;
      const email = document.getElementById('f-profile-email').value.trim().toLowerCase();
      const duplicate = db.users.some(other=>other.id!==user.id && (other.email||'').toLowerCase()===email);
      if(duplicate){ alert('That email is already taken.'); return; }
      user.name = document.getElementById('f-profile-name').value.trim();
      user.email = email;
      const removePhoto = document.getElementById('f-profile-remove-photo');
      const photoInput = document.getElementById('f-profile-photo');
      if(removePhoto && removePhoto.checked) user.photoDataUrl = '';
      if(photoInput && photoInput.files && photoInput.files[0]) user.photoDataUrl = await readFileAsDataUrl(photoInput.files[0]);
      await saveDB(); closeModal(); showToast('Profile updated.');
    } else if(type==='addTeacher'){
      const name = document.getElementById('f-name').value.trim();
      const email = document.getElementById('f-email').value.trim().toLowerCase();
      const username = document.getElementById('f-username').value.trim();
      const password = document.getElementById('f-password').value;
      if(db.users.some(u=>u.username===username || (u.email||'').toLowerCase()===email)){ alert('That username or email is already taken.'); return; }
      db.users.push({ id: uid('u'), role:'teacher', username, email, password, name });
      await saveDB(); closeModal(); showToast('Teacher account created.');
    } else if(type==='addStudent'){
      const name = document.getElementById('f-name').value.trim();
      const email = document.getElementById('f-email').value.trim().toLowerCase();
      const lrn = generateUniqueLrn();
      const username = document.getElementById('f-username').value.trim();
      const password = document.getElementById('f-password').value;
      const classId = document.getElementById('f-class').value;
      if(db.users.some(u=>u.username===username || (u.email||'').toLowerCase()===email)){ alert('That username or email is already taken.'); return; }
      db.users.push({ id: uid('u'), role:'student', username, email, password, name, lrn, classId });
      await saveDB(); closeModal(); showToast('Student account created.');
    } else if(type==='addClass'){
      const grade = document.getElementById('f-grade').value.trim();
      const section = document.getElementById('f-section').value.trim();
      const teacherId = document.getElementById('f-teacher').value;
      db.classes.push({ id: uid('c'), grade, section, teacherId });
      await saveDB(); closeModal(); showToast('Section created.');
    } else if(type==='postWork'){
      const classSubjectId = document.getElementById('f-class-subject').value;
      const mtype = document.getElementById('f-type').value;
      const title = document.getElementById('f-title').value.trim();
      const description = document.getElementById('f-desc').value.trim();
      const dueDate = document.getElementById('f-due').value;
      const fileInput = document.getElementById('f-files');
      const chosenFiles = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
      const totalBytes = chosenFiles.reduce((sum,f)=>sum+f.size, 0);
      if(totalBytes > 4 * 1024 * 1024){
        alert('Attached files are too large (about ' + fmtFileSize(totalBytes) + '). Please keep total attachments under ~4MB.');
        return;
      }
      const submitBtn = document.getElementById('post-work-submit');
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Posting…'; }
      let attachments = [];
      try{
        attachments = await Promise.all(chosenFiles.map(async f=>({
          id: uid('file'),
          name: f.name,
          size: f.size,
          mimeType: f.type,
          dataUrl: await readFileAsDataUrl(f),
        })));
      }catch(err){
        console.error('attachment read failed', err);
        alert('One of the attached files could not be read. Please try again.');
        if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Post to class'; }
        return;
      }
      const allowOnlineSubmission = document.getElementById('f-allow-submit').checked;
      db.materials.push({ id: uid('m'), classId: state.selectedClassId, classSubjectId, type:mtype, title, description, dueDate, allowOnlineSubmission, postedAt: new Date().toISOString().slice(0,10), attachments });
      await saveDB(); closeModal(); showToast('Posted to class.');
    } else if(type==='submitWork'){
      const materialId = state.modal.payload.materialId;
      const material = db.materials.find(m=>m.id===materialId);
      if(!material){ closeModal(); return; }
      const textAnswer = document.getElementById('f-submit-text').value.trim();
      const fileInput = document.getElementById('f-submit-file');
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      const existing = submissionFor(materialId, state.currentUser.id);
      if(!textAnswer && !file && !(existing && existing.fileName)){
        alert('Add a note or attach a file before submitting.');
        return;
      }
      if(file && file.size > 4 * 1024 * 1024){
        alert('That file is too large (about ' + fmtFileSize(file.size) + '). Please keep it under ~4MB.');
        return;
      }
      const submitBtn = document.getElementById('submit-work-submit');
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
      let fileData = existing ? { fileName: existing.fileName||'', fileSize: existing.fileSize, fileMimeType: existing.fileMimeType||'', fileDataUrl: existing.fileDataUrl||'' } : { fileName:'', fileSize:undefined, fileMimeType:'', fileDataUrl:'' };
      if(file){
        try{
          fileData = { fileName: file.name, fileSize: file.size, fileMimeType: file.type, fileDataUrl: await readFileAsDataUrl(file) };
        }catch(err){
          console.error('submission file read failed', err);
          alert('That file could not be read. Please try again.');
          if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = existing?'Update submission':'Submit'; }
          return;
        }
      }
      if(existing){
        existing.textAnswer = textAnswer;
        Object.assign(existing, fileData);
        existing.submittedAt = new Date().toISOString();
      }else{
        db.submissions.push({ id: uid('sub'), materialId, studentId: state.currentUser.id, textAnswer, ...fileData, submittedAt: new Date().toISOString() });
      }
      await saveDB(); closeModal(); showToast('Work submitted.');
    } else if(type==='addSubject'){
      const name = document.getElementById('f-subject-name').value.trim();
      const code = document.getElementById('f-subject-code').value.trim().toUpperCase();
      if(db.subjects.some(subject=>subject.name.toLowerCase()===name.toLowerCase())){ alert('That subject already exists.'); return; }
      db.subjects.push({ id:uid('sub'), code, name, active:true });
      await saveDB(); closeModal(); showToast('Subject created.');
    } else if(type==='addBehavior'){
      const studentId = document.getElementById('f-behavior-student').value;
      const btype = document.getElementById('f-behavior-type').value;
      const category = document.getElementById('f-behavior-category').value.trim();
      const note = document.getElementById('f-behavior-note').value.trim();
      const date = document.getElementById('f-behavior-date').value || new Date().toISOString().slice(0,10);
      if(!studentId){ alert('Choose a student.'); return; }
      db.behavior.push({ id:uid('beh'), studentId, classId: state.modal.payload.classId, type:btype, category, note, date, recordedBy: state.currentUser.id });
      await saveDB(); closeModal(); showToast('Behavior record saved.');
    } else if(type==='assignSubject'){
      const subjectId = document.getElementById('f-subject').value;
      const teacherId = document.getElementById('f-subject-teacher').value;
      if(!subjectId){ alert('Choose a subject first.'); return; }
      const classId = state.modal.payload.classId;
      if(db.classSubjects.some(cs=>cs.classId===classId && cs.subjectId===subjectId)){ alert('That subject is already assigned to this class.'); return; }
      db.classSubjects.push({ id:uid('cs'), classId, subjectId, teacherId });
      await saveDB(); closeModal(); showToast('Subject assigned to class.');
    }
  };
}

/* ---------------------- boot ---------------------- */
(async function boot(){
  document.getElementById('app').innerHTML = `<div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--ink-navy); color:var(--parchment); font-family:'IBM Plex Mono',monospace; font-size:0.85rem; letter-spacing:1px;">LOADING PORTAL…</div>`;
  await loadDB();
  render();
})();
