import { useState, useEffect } from "react";

const SUPABASE_URL = "https://zaebyhuuwnsvhhnnhcsj.supabase.co";
const SUPABASE_KEY = "sb_publishable_JnmOtNTTux_wONg0ULPPZA_0xebodgL";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Sunday"];
const DAY_SHORT = { Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu",Friday:"Fri",Sunday:"Sun" };
const HOURS = [17,18,19,20,21];
const SUNDAY_HOURS = [10.5,11.5,12.5,13.5,14.5,15.5,16.5];
const MAX_SLOTS = 4;
const DEFAULT_LEVEL_TEMPLATE = { 17:"Medium beginner",18:"Medium to high beginner",19:"Medium intermediate",20:"Medium beginner",21:"" };
const SUNDAY_LEVEL_TEMPLATE = { 10.5:"Low beginner",11.5:"Medium beginner",12.5:"Private",13.5:"Medium to high beginner",14.5:"High beginner",15.5:"Low to medium beginner",16.5:"Medium beginner" };

function getDayHours(day) { return day==="Sunday" ? SUNDAY_HOURS : HOURS; }

// Default levels are per-day (same template for each day initially)
function buildDefaultLevels() {
  const out = {};
  DAYS.forEach(day => {
    const hours = getDayHours(day);
    const template = day==="Sunday" ? SUNDAY_LEVEL_TEMPLATE : DEFAULT_LEVEL_TEMPLATE;
    hours.forEach(h => { out[`${day}-${h}`] = template[h]||""; });
  });
  return out;
}

function fmt(h) {
  const hrs = Math.floor(h);
  const mins = h % 1 === 0.5 ? "30" : "00";
  const period = hrs < 12 ? "AM" : "PM";
  const display = hrs <= 12 ? hrs : hrs - 12;
  return `${display}:${mins} ${period}`;
}

function fmtEnd(h) {
  const end = h + 1;
  return fmt(end);
}

function getWeekDates(offsetWeeks=0) {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate()-((dow+6)%7)+offsetWeeks*7);
  monday.setHours(0,0,0,0);
  const offsets = {Monday:0,Tuesday:1,Wednesday:2,Thursday:3,Friday:4,Sunday:6};
  const result = {};
  DAYS.forEach(d=>{const dt=new Date(monday);dt.setDate(monday.getDate()+offsets[d]);result[d]=dt;});
  return result;
}

function fmtDate(date) { return date.toLocaleDateString("en-IE",{day:"numeric",month:"short"}); }
function isToday(date) { return date.toDateString()===new Date().toDateString(); }
function isPast(date,hour) { const s=new Date(date);s.setHours(Math.floor(hour),hour%1===0.5?30:0,0,0);return s<new Date(); }

function weekKey(date) {
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const dayNum=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-dayNum);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2,"00")}`;
}

function slotId(day,hour) { return `${day}-${hour}`; }
function hashPin(pin) {
  let h=0;
  for(let i=0;i<pin.length;i++){h=(Math.imul(31,h)+pin.charCodeAt(i))|0;}
  return String(Math.abs(h));
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sb(path, method="GET", body=null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method==="POST" ? "resolution=merge-duplicates,return=minimal" : "return=representation,count=exact",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if(method==="GET") return res.json();
  return res;
}

async function dbGetAll() {
  const [recurring, cancelled, levels, blocked, adminRows] = await Promise.all([
    sb("recurring?select=*"),
    sb("cancelled?select=*"),
    sb("class_levels?select=*"),
    sb("blocked_days?select=*"),
    sb("admin_pin?select=*"),
  ]);
  return { recurring, cancelled, levels, blocked, adminRows };
}

export default function PadelBooking() {
  const [recurring,setRecurring]     = useState([]);
  const [cancelled,setCancelled]     = useState([]);
  // classLevels keyed by "Day-hour" e.g. "Monday-17"
  const [classLevels,setClassLevels] = useState(buildDefaultLevels());
  const [editingLevel,setEditingLevel] = useState(null); // hour number or null
  const [levelDraft,setLevelDraft]   = useState("");
  const [blockedDays,setBlockedDays] = useState([]);
  const [adminPinHash,setAdminPinHash] = useState(null);
  const [weekOffset,setWeekOffset]   = useState(()=>{ try { return parseInt(sessionStorage.getItem("weekOffset")||"0",10); } catch{ return 0; }});
  const [activeDay,setActiveDay]     = useState(()=>{ try { return sessionStorage.getItem("activeDay")||null; } catch{ return null; }});
  const [modal,setModal]             = useState(null);
  const [form,setForm]               = useState({name:"",pin:"",confirmPin:""});
  const [pinError,setPinError]       = useState("");
  const [toast,setToast]             = useState(null);
  const [loading,setLoading]         = useState(true);

  const weekDates = getWeekDates(weekOffset);

  useEffect(()=>{ try { sessionStorage.setItem("weekOffset",weekOffset); } catch{} loadAll(); },[weekOffset]);
  useEffect(()=>{ try { if(activeDay) sessionStorage.setItem("activeDay",activeDay); } catch{} },[activeDay]);

  useEffect(()=>{
    if(!activeDay) {
      const t=DAYS.find(d=>isToday(getWeekDates(0)[d]));
      setActiveDay(t||"Monday");
    }
    // Handle Stripe redirect
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if(payment==="success") {
      const rep = params.get("rep");
      showToast(`${rep ? rep + " booked" : "Booking confirmed"} ✅ Payment received!`);
      window.history.replaceState({}, "", "/");
    } else if(payment==="cancelled") {
      showToast("Payment cancelled — slot is still open.", "err");
      window.history.replaceState({}, "", "/");
    }
    loadAll();
  },[]);

  async function loadAll() {
    setLoading(true);
    try {
      const {recurring:r,cancelled:c,levels:l,blocked:b,adminRows:a} = await dbGetAll();
      if(Array.isArray(r)) setRecurring(r);
      if(Array.isArray(c)) setCancelled(c);
      if(Array.isArray(l) && l.length) {
        const lv = buildDefaultLevels();
        const currentWeeks = {};
        DAYS.forEach(day => { currentWeeks[day] = weekKey(getWeekDates(weekOffset)[day]); });
        // Group by day-hour, pick current week first, then most recent
        const grouped = {};
        l.forEach(row => {
          const k = row.day ? `${row.day}-${row.hour}` : null;
          if(!k) { DAYS.forEach(day => { lv[`${day}-${row.hour}`] = row.level; }); return; }
          if(!grouped[k]) grouped[k] = [];
          grouped[k].push(row);
        });
        Object.entries(grouped).forEach(([k, rows]) => {
          const day = k.split('-')[0];
          const currentWk = currentWeeks[day];
          const current = rows.find(r => r.week_key === currentWk);
          if(current) { lv[k] = current.level; return; }
          // Fall back to most recent past week's level
          const past = rows.filter(r => r.week_key && r.week_key <= currentWk).sort((a,b)=>b.week_key.localeCompare(a.week_key));
          if(past.length) lv[k] = past[0].level;
        });
        setClassLevels(lv);
      }
      if(Array.isArray(b)) setBlockedDays(b);
      if(Array.isArray(a) && a.length) setAdminPinHash(a[0].pin_hash);
    } catch(e){ showToast("Connection error","err"); }
    setLoading(false);
  }

  // ── Slot helpers ────────────────────────────────────────────────────────────
  function getAllRecurring(day,hour) {
    return recurring.filter(p=>p.slot_id===slotId(day,hour));
  }

  function getCancelledNames(key) {
    const row=cancelled.find(c=>c.cancel_key===key);
    return row ? row.names : [];
  }

  function getPlayers(day,hour) {
    const base=getAllRecurring(day,hour);
    const wk=weekKey(weekDates[day]);
    const skipped=getCancelledNames(`${wk}-${slotId(day,hour)}`);
    return base.filter(p=>!skipped.includes(p.name));
  }

  function isSkipped(day,hour,name) {
    const wk=weekKey(weekDates[day]);
    return getCancelledNames(`${wk}-${slotId(day,hour)}`).includes(name);
  }

  function getReplacement(day,hour,originalName) {
    const wk=weekKey(weekDates[day]);
    const names=getCancelledNames(`${wk}-rep-${slotId(day,hour)}-${originalName}`);
    if(!names.length) return null;
    return typeof names[0]==="object" ? names[0] : null;
  }

  // ── DB writes ───────────────────────────────────────────────────────────────
  async function upsertCancelled(key, names) {
    const updateRes = await sb(`cancelled?cancel_key=eq.${encodeURIComponent(key)}`, "PATCH", {names});
    const count = updateRes.headers ? updateRes.headers.get("content-range") : null;
    if(count === "*/0" || count === null) {
      await sb("cancelled", "POST", {cancel_key: key, names});
    }
    setCancelled(prev=>{
      const exists=prev.find(c=>c.cancel_key===key);
      if(exists) return prev.map(c=>c.cancel_key===key?{...c,names}:c);
      return [...prev,{cancel_key:key,names}];
    });
  }

  // Save level per day+hour — uses day+hour as compound key stored as a single "hour" field
  // We store as {day, hour, level} in Supabase. The table needs a `day` column.
  // We use hour as a string "Day-hour" for the unique key via the id field.
  async function saveClassLevel(day, hour, level) {
    const wk=weekKey(weekDates[day]);
    const id=`${wk}-${day}-${hour}`;
    await sb("class_levels", "POST", {id, day, hour, level, week_key:wk});
    setClassLevels(prev=>({...prev,[`${day}-${hour}`]:level}));
  }

  async function saveAdminPin(hash) {
    await sb("admin_pin","POST",{id:1,pin_hash:hash});
    setAdminPinHash(hash);
  }

  // ── Day blocking ────────────────────────────────────────────────────────────
  function dayBlockKey(day) { return `${weekKey(weekDates[day])}-${day}`; }
  function isDayBlocked(day) { return !!blockedDays.find(b=>b.block_key===dayBlockKey(day)); }
  function getDayBlockReason(day) {
    const b=blockedDays.find(b=>b.block_key===dayBlockKey(day));
    return b ? b.reason : "";
  }

  function handleAdminAction(action,extras={}) {
    if(!adminPinHash) openModal("admin-setup",{action,...extras});
    else openModal("admin-verify",{action,...extras});
  }

  async function handleAdminSetup() {
    const pin=form.pin.trim(), confirmPin=form.confirmPin.trim();
    if(pin.length<4||pin.length>6){setPinError("PIN must be 4–6 digits");return;}
    if(pin!==confirmPin){setPinError("PINs don't match");return;}
    await saveAdminPin(hashPin(pin));
    const {action,day,hour}=modal;
    setPinError(""); setModal(null);
    if(action==="block") openModal("block-reason",{day});
    else if(action==="unblock") doUnblockDay(day);
    else if(action==="edit-level") { setEditingLevel(hour); setLevelDraft(classLevels[`${day}-${hour}`]||""); }
  }

  function handleAdminVerify() {
    if(hashPin(form.pin)!==adminPinHash){setPinError("Incorrect coach PIN");return;}
    const {action,day}=modal;
    setPinError("");
    if(action==="block") openModal("block-reason",{day});
    else if(action==="unblock"){setModal(null);doUnblockDay(day);}
  }

  function handleAdminVerifyEditLevel() {
    if(hashPin(form.pin)!==adminPinHash){setPinError("Incorrect coach PIN");return;}
    const {day,hour}=modal;
    setPinError(""); setModal(null);
    setEditingLevel(hour); setLevelDraft(classLevels[`${day}-${hour}`]||"");
  }

  async function doBlockDay(day,reason) {
    const key=dayBlockKey(day);
    const r=reason||"Cancelled";
    await sb("blocked_days","POST",{block_key:key,reason:r});
    setBlockedDays(prev=>{
      const exists=prev.find(b=>b.block_key===key);
      if(exists) return prev.map(b=>b.block_key===key?{...b,reason:r}:b);
      return [...prev,{block_key:key,reason:r}];
    });
    showToast(`${day} blocked for this week`);
  }

  async function doUnblockDay(day) {
    const key=dayBlockKey(day);
    await sb(`blocked_days?block_key=eq.${key}`,"DELETE");
    setBlockedDays(prev=>prev.filter(b=>b.block_key!==key));
    showToast(`${day} reopened`);
  }

  // ── Player actions ──────────────────────────────────────────────────────────
  function showToast(msg,type="ok"){setToast({msg,type});setTimeout(()=>setToast(null),3200);}
  function openModal(type,extras={}){setModal({type,...extras});setForm({name:"",pin:"",confirmPin:""});setPinError("");}

  async function handleAdd() {
    if(weekOffset<0){showToast("Can't book slots in a past week","err");return;}
    const name=form.name.trim(), pin=form.pin.trim(), confirmPin=form.confirmPin.trim();
    if(!name){setPinError("Enter a name");return;}
    if(pin.length!==4){setPinError("PIN must be exactly 4 digits");return;}
    if(pin!==confirmPin){setPinError("PINs don't match");return;}
    const {day,hour}=modal;
    const all=getAllRecurring(day,hour);
    const wk=weekKey(weekDates[day]);
    const skippedNames=getCancelledNames(`${wk}-${slotId(day,hour)}`);
    const subsCount=skippedNames.filter(name=>getReplacement(day,hour,name)).length;
    if(getPlayers(day,hour).length+subsCount>=MAX_SLOTS){showToast("Court is full!","err");return;}
    if(all.map(p=>p.name.toLowerCase()).includes(name.toLowerCase())){setPinError("Name already in this slot");return;}
    const newPlayer={slot_id:slotId(day,hour),name,pin_hash:hashPin(pin)};
    await sb("recurring","POST",newPlayer);
    setRecurring(prev=>[...prev,newPlayer]);
    setModal(null);
    showToast(`${name} booked every ${day} at ${fmt(hour)} 🎾`);
  }

  function handlePinVerify() {
    const {day,hour,name,action}=modal;
    const all=getAllRecurring(day,hour);
    const player=all.find(p=>p.name===name);
    const entered=hashPin(form.pin);
    const coachOk=adminPinHash&&entered===adminPinHash;
    if(!player||(entered!==player.pin_hash&&!coachOk)){setPinError("Incorrect PIN");return;}
    setPinError("");
    if(action==="skip") doSkip(day,hour,name);
    else if(action==="remove") openModal("confirm-remove",{day,hour,name});
  }

  async function doSkip(day,hour,name) {
    const wk=weekKey(weekDates[day]);
    const key=`${wk}-${slotId(day,hour)}`;
    const current=getCancelledNames(key);
    await upsertCancelled(key,[...current,name]);
    setModal(null);
    showToast(`${name} skipped this week`);
  }

  function handleUndoSkipVerify() {
    const {day,hour,name}=modal;
    const all=getAllRecurring(day,hour);
    const player=all.find(p=>p.name===name);
    const entered=hashPin(form.pin);
    const coachOk=adminPinHash&&entered===adminPinHash;
    if(!player||(entered!==player.pin_hash&&!coachOk)){setPinError("Incorrect PIN");return;}
    setPinError("");
    doUndoSkip(day,hour,name);
    setModal(null);
  }

  async function doUndoSkip(day,hour,name) {
    const wk=weekKey(weekDates[day]);
    const key=`${wk}-${slotId(day,hour)}`;
    const repKey=`${wk}-rep-${slotId(day,hour)}-${name}`;
    const current=getCancelledNames(key).filter(n=>n!==name);
    await upsertCancelled(key,current);
    await upsertCancelled(repKey,[]);
    showToast(`${name} is back this week`);
  }

  async function doRemove(day,hour,name) {
    const sid=slotId(day,hour);
    await sb(`recurring?slot_id=eq.${encodeURIComponent(sid)}&name=eq.${encodeURIComponent(name)}`,"DELETE");
    setRecurring(prev=>prev.filter(p=>!(p.slot_id===sid&&p.name===name)));
    setModal(null);
    showToast(`${name} removed from weekly slot`);
  }

  async function handleAddReplacement() {
    const name=form.name.trim(), pin=form.pin.trim(), confirmPin=form.confirmPin.trim();
    if(!name){setPinError("Enter a name");return;}
    if(pin.length!==4){setPinError("PIN must be exactly 4 digits");return;}
    if(pin!==confirmPin){setPinError("PINs don't match");return;}
    const {day,hour,originalName}=modal;
    const wk=weekKey(weekDates[day]);
    const repPinHash=hashPin(pin);

    setModal(null);
    showToast("Redirecting to payment…");

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, hour, originalName, repName: name, repPinHash, weekKey: wk }),
      });
      const data = await res.json();
      if(data.url) {
        window.location.href = data.url;
      } else {
        showToast("Payment setup failed. Try again.", "err");
      }
    } catch(err) {
      showToast("Connection error. Try again.", "err");
    }
  }

  function handleRemoveRepVerify() {
    const {repPinHash}=modal;
    const entered=hashPin(form.pin);
    const coachOk=adminPinHash&&entered===adminPinHash;
    if(entered!==repPinHash&&!coachOk){setPinError("Incorrect PIN");return;}
    doRemoveReplacement();
  }

  async function doRemoveReplacement() {
    const {day,hour,originalName}=modal;
    const wk=weekKey(weekDates[day]);
    const repKey=`${wk}-rep-${slotId(day,hour)}-${originalName}`;
    await upsertCancelled(repKey,[]);
    setModal(null);
    showToast("Substitute removed");
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const today=activeDay||"Monday";

  function calcOpenSpots(days) {
    return days.reduce((acc,d)=>{
      const wk=weekKey(weekDates[d]);
      return acc+getDayHours(d).reduce((a,h)=>{
        const allRec=getAllRecurring(d,h);
        const skippedNames=getCancelledNames(`${wk}-${slotId(d,h)}`);
        const skipsNoSub=skippedNames.filter(name=>!getReplacement(d,h,name)).length;
        // active = recurring players who haven't skipped + subs filling skipped spots
        const subsCount=skippedNames.length-skipsNoSub;
        const active=(allRec.length-skippedNames.length)+subsCount;
        const empty=Math.max(0,MAX_SLOTS-active-skipsNoSub);
        return a+skipsNoSub+empty;
      },0);
    },0);
  }

  const dayOpen=calcOpenSpots([today]);
  const weekOpen=calcOpenSpots(DAYS);

  function getOpenSlotsDetail(days) {
    const detail = [];
    days.forEach(d => {
      const wk = weekKey(weekDates[d]);
      getDayHours(d).forEach(h => {
        const allRec = getAllRecurring(d,h);
        const skippedNames = getCancelledNames(`${wk}-${slotId(d,h)}`);
        const skipsNoSub = skippedNames.filter(name=>!getReplacement(d,h,name)).length;
        const subsCount = skippedNames.length - skipsNoSub;
        const active = (allRec.length - skippedNames.length) + subsCount;
        const empty = Math.max(0, MAX_SLOTS - active - skipsNoSub);
        const open = skipsNoSub + empty;
        if(open > 0) {
          const skippedNoSubNames = skippedNames.filter(name=>!getReplacement(d,h,name));
          detail.push({ day:d, hour:h, open, empty, skippedNoSubNames });
        }
      });
    });
    return detail;
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#f0f2f5",fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",color:"var(--text-primary)"}}>
      <style>{`
        *{box-sizing:border-box;}::-webkit-scrollbar{display:none;}
        html, body { background-color: #f0f2f5 !important; color: #1a1a2e !important; }

        :root {
          --bg-page: #f0f2f5;
          --bg-header: #2B4EFF;
          --bg-card: #ffffff;
          --bg-pill: #f0f0f0;
          --bg-pill-skipped: #e8e8e8;
          --bg-input: #f5f5f5;
          --bg-slot-empty: #f9f9f9;
          --bg-tab: #ffffff;
          --bg-tab-hover: #f0f2f5;
          --bg-modal-overlay: rgba(0,0,0,0.45);
          --bg-summary-slot: #f9f9f9;
          --text-primary: #1a1a2e;
          --text-secondary: #555566;
          --text-muted: #8888a0;
          --text-pill: #1a1a2e;
          --text-pill-skipped: #888899;
          --border-card: #e8e8f0;
          --border-input: #dddde8;
          --border-slot-empty: #e0e0e8;
          --border-summary-slot: #ebebf5;
          --accent: #BFFF00;
          --accent-text: #1a1a2e;
        }
        @keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes popIn{from{opacity:0;transform:scale(0.93)}to{opacity:1;transform:scale(1)}}
        @keyframes toastSlide{from{opacity:0;transform:translateY(16px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .day-tab{transition:all 0.15s;cursor:pointer;}.day-tab:hover{background:var(--bg-tab-hover)!important;}.day-tab.active{background:#2B4EFF!important;color:#ffffff!important;}
        .slot-row{transition:box-shadow 0.15s,transform 0.15s;}.slot-row:hover{box-shadow:0 4px 20px rgba(0,0,0,0.08);transform:translateY(-1px);}
        .week-nav:hover{background:var(--bg-tab-hover)!important;}
        .pill:hover{filter:brightness(0.95);}
        input:focus{outline:none;border-color:#2B4EFF!important;}
        .pin-input{letter-spacing:6px;font-size:22px;text-align:center;}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"#2B4EFF",padding:"28px 24px 24px",position:"relative",overflow:"hidden"}}>
        <div style={{maxWidth:680,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6}}>
            <span style={{fontSize:28}}>🎾</span>
            <div>
              <h1 style={{margin:0,fontSize:"clamp(20px,4vw,30px)",fontWeight:"bold",color:"#f5f0e8",letterSpacing:"-0.5px"}}>Celbridge Padel Academy</h1>
              <p style={{margin:0,fontSize:13,color:"#d0c8b8",marginTop:3,letterSpacing:"0.3px"}}>Padelzone Celbridge | W23 YX30</p>
            </div>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"nowrap",marginTop:16}}>
            <div onClick={()=>openModal("open-slots-summary",{days:[today],title:"Day's Open Slots"})} style={{flex:1,background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"8px 10px",border:"1px solid rgba(255,255,255,0.4)",minWidth:0,cursor:"pointer"}}>
              <div style={{fontSize:20,fontWeight:"bold",color:dayOpen>0?"#f97316":"#c8e84a"}}>{dayOpen}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.8)",letterSpacing:0.5,textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Day's open slots</div>
            </div>
            <div onClick={()=>openModal("open-slots-summary",{days:DAYS,title:"Week's Open Spots"})} style={{flex:1,background:"rgba(255,255,255,0.15)",borderRadius:10,padding:"8px 10px",border:"1px solid rgba(255,255,255,0.4)",minWidth:0,cursor:"pointer"}}>
              <div style={{fontSize:20,fontWeight:"bold",color:weekOpen>0?"#f97316":"#BFFF00"}}>{weekOpen}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.8)",letterSpacing:0.5,textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Week's open spots</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"24px 16px 80px"}}>

        {loading&&(
          <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-secondary)"}}>
            <div style={{fontSize:32,animation:"spin 1s linear infinite",display:"inline-block"}}>🎾</div>
            <p style={{marginTop:12}}>Loading bookings…</p>
          </div>
        )}

        {!loading&&(<>

        {/* ── WEEK NAV ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <button className="week-nav" onClick={()=>setWeekOffset(w=>w-1)} style={{background:"#ffffff",border:"none",borderRadius:8,padding:"8px 14px",boxShadow:"0 2px 8px rgba(0,0,0,0.08)",cursor:"pointer",fontSize:18}}>‹</button>
          <div style={{textAlign:"center"}}>
            <div style={{fontWeight:"bold",fontSize:15}}>
              {weekOffset===0?"This Week":weekOffset>0?`+${weekOffset} week${weekOffset>1?"s":""}`:
               `${Math.abs(weekOffset)} week${Math.abs(weekOffset)>1?"s":""} ago`}
            </div>
            <div style={{fontSize:12,color:"var(--text-secondary)"}}>{fmtDate(weekDates["Monday"])} – {fmtDate(weekDates["Sunday"])}</div>
          </div>
          <button className="week-nav" onClick={()=>setWeekOffset(w=>w+1)} style={{background:"#ffffff",border:"none",borderRadius:8,padding:"8px 14px",boxShadow:"0 2px 8px rgba(0,0,0,0.08)",cursor:"pointer",fontSize:18}}>›</button>
        </div>

        {/* ── DAY TABS ── */}
        <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
          {DAYS.map(day=>{
            const d=weekDates[day];
            const isTod=isToday(d);
            const active=day===today;
            const blocked=isDayBlocked(day);
            return (
              <button key={day} className={`day-tab${active?" active":""}`} onClick={()=>setActiveDay(day)} style={{
                flex:"0 0 auto",padding:"8px 14px",borderRadius:10,
                border:blocked?"1.5px solid #c0392b":"none",
                boxShadow:blocked?"none":active?"0 2px 8px rgba(43,78,255,0.25)":"0 2px 8px rgba(0,0,0,0.08)",
                background:blocked?(active?"#7b1010":"#fdecea"):active?"#2B4EFF":"#ffffff",
                color:blocked?(active?"#fff":"#c0392b"):active?"#fff":"#1a1a2e",
                cursor:"pointer",textAlign:"center",minWidth:68,opacity:blocked?0.6:1,
              }}>
                <div style={{fontSize:11,letterSpacing:1,textTransform:"uppercase",opacity:0.7}}>{blocked?"🔒 ":""}{DAY_SHORT[day]}</div>
                <div style={{fontSize:14,fontWeight:"bold",marginTop:1,textDecoration:blocked?"line-through":"none"}}>
                  {fmtDate(d)}
                  {isTod&&!blocked&&<span style={{display:"block",width:5,height:5,borderRadius:"50%",background:"#BFFF00",margin:"2px auto 0"}}/>}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── BLOCK / UNBLOCK ── */}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
          {isDayBlocked(today)?(
            <button onClick={()=>handleAdminAction("unblock",{day:today})} style={{background:"#ffffff",border:"none",boxShadow:"0 2px 8px rgba(0,0,0,0.08)",borderRadius:8,padding:"5px 14px",fontSize:12,color:"#c0392b",cursor:"pointer",fontFamily:"inherit"}}>
              🔓 Unblock {today}
            </button>
          ):(
            <button onClick={()=>handleAdminAction("block",{day:today})} style={{background:"#ffffff",border:"none",boxShadow:"0 2px 8px rgba(0,0,0,0.08)",borderRadius:8,padding:"5px 14px",fontSize:12,color:"#2B4EFF",cursor:"pointer",fontFamily:"inherit"}}>
              🔒 Block {today}
            </button>
          )}
        </div>

        {/* ── BLOCKED BANNER or SLOTS ── */}
        {isDayBlocked(today)?(
          <div style={{background:"#fdecea",border:"1.5px solid #f4c2c2",borderRadius:14,padding:"32px 24px",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🔒</div>
            <div style={{fontSize:18,fontWeight:"bold",color:"#c0392b",marginBottom:8}}>Classes Cancelled</div>
            {getDayBlockReason(today)&&<div style={{fontSize:14,color:"#7a4040"}}>{getDayBlockReason(today)}</div>}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10,animation:"slideUp 0.25s ease"}}>
            {getDayHours(today).map(hour=>{
              const allRec=getAllRecurring(today,hour);
              const players=getPlayers(today,hour);
              const past=isPast(weekDates[today],hour);
              const wkKey=weekKey(weekDates[today]);
              const skippedNames=getCancelledNames(`${wkKey}-${slotId(today,hour)}`);
              const subsCount=skippedNames.filter(name=>getReplacement(today,hour,name)).length;
              const effectiveCount=players.length+subsCount;
              const full=effectiveCount>=MAX_SLOTS;
              const levelKey=`${today}-${hour}`;

              return (
                <div key={hour} className="slot-row" style={{background:"#ffffff",borderRadius:14,border:"none",boxShadow:full?"0 2px 8px rgba(192,57,43,0.2)":"0 2px 8px rgba(0,0,0,0.08)",padding:"16px 18px",opacity:past?0.55:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div>
                        <span style={{fontSize:17,fontWeight:"bold"}}>{fmt(hour)}</span>
                        <span style={{color:"var(--text-muted)",fontSize:13,marginLeft:6}}>→ {fmtEnd(hour)}</span>
                      </div>
                      {editingLevel===hour?(
                        <div style={{marginTop:4,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <input autoFocus value={levelDraft}
                            onChange={e=>setLevelDraft(e.target.value)}
                            onKeyDown={e=>{
                              if(e.key==="Enter"){saveClassLevel(today,hour,levelDraft);setEditingLevel(null);}
                              if(e.key==="Escape")setEditingLevel(null);
                            }}
                            placeholder="e.g. Medium beginner"
                            style={{fontSize:12,padding:"3px 10px",borderRadius:8,border:"1.5px solid #1a1a2e",background:"var(--bg-input)",color:"#1a1a2e",width:190}}
                          />
                          <button onClick={()=>{saveClassLevel(today,hour,levelDraft);setEditingLevel(null);}} style={{background:"#2B4EFF",border:"none",borderRadius:8,padding:"3px 10px",color:"#f5f0e8",fontSize:12,cursor:"pointer"}}>✓</button>
                          <button onClick={()=>setEditingLevel(null)} style={{background:"#e8eeff",border:"none",borderRadius:8,padding:"3px 8px",color:"var(--text-secondary)",fontSize:12,cursor:"pointer"}}>✕</button>
                        </div>
                      ):(
                        <div style={{marginTop:3,display:"flex",alignItems:"center",gap:5}}>
                          <span style={{fontSize:12,color:"#7a6050"}}>{classLevels[levelKey]||<em style={{opacity:0.4}}>no level set</em>}</span>
                          {!past&&<button onClick={()=>{
                            if(!adminPinHash){openModal("admin-setup",{action:"edit-level",day:today,hour});return;}
                            openModal("admin-verify-edit-level",{day:today,hour});
                          }} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#c0b8a8",padding:0}}>✏️</button>}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {full?(
                        <span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:"#fdecea",color:"#c0392b",letterSpacing:0.5}}>FULL</span>
                      ):(
                        <span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",letterSpacing:0.5}}>{effectiveCount}/{MAX_SLOTS}</span>
                      )}
                    </div>
                  </div>

                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Array.from({length:MAX_SLOTS}).map((_,i)=>{
                      const player=allRec[i];
                      if(!player) {
                        return (
                          <div key={i}
                            onClick={()=>!past&&!full&&weekOffset>=0&&openModal("add",{day:today,hour})}
                            onMouseEnter={e=>{if(!past&&!full){e.currentTarget.style.background="#f0ede4";e.currentTarget.style.borderColor="#a09880";}}}
                            onMouseLeave={e=>{e.currentTarget.style.background="#faf8f4";e.currentTarget.style.borderColor="#ddd6c8";}}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",borderRadius:20,border:"1.5px dashed #ddd6c8",background:"var(--bg-slot-empty)",cursor:past||full?"default":"pointer",transition:"background 0.15s,border-color 0.15s"}}>
                            <span style={{fontSize:11,color:"#c0b8a8",flexShrink:0}}>{i+1}</span>
                            <span style={{fontSize:14,color:"#c0b8a8",fontStyle:"italic",fontWeight:"bold"}}>{past?"—":"Open"}</span>
                            {!past&&!full&&<span style={{fontSize:18,color:"#00a86b",flexShrink:0,marginLeft:"auto"}}>●</span>}
                          </div>
                        );
                      }
                      const {name}=player;
                      const skipped=isSkipped(today,hour,name);
                      const rep=getReplacement(today,hour,name);

                      return (
                        <div key={name} style={{display:"flex",flexDirection:"column",gap:2}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            {rep?(
                              /* ── Sub in same position, swapped colour ── */
                              <div className="pill" onClick={()=>!past&&openModal("sub-actions",{day:today,hour,originalName:name,repName:rep.name,repPinHash:rep.pinHash})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,flex:1,minWidth:0,background:"#e8f5e9",borderRadius:20,padding:"9px 14px",fontSize:14,color:"#2e7d32",border:"1px solid #c8e6c9",cursor:past?"default":"pointer"}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0,flex:1}}>
                                  <span style={{fontSize:11,color:"#81c784",flexShrink:0}}>{i+1}</span>
                                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{rep.name}</span>
                                  <span style={{fontSize:9,color:"#fff",background:"#2e7d32",borderRadius:20,padding:"2px 6px",flexShrink:0}}>PAID</span>
                                </div>
                                {!past&&<span style={{fontSize:16,color:"#81c784",flexShrink:0}}>☰</span>}
                              </div>
                            ):(
                              /* ── Original player ── */
                              <div className="pill" onClick={()=>!past&&openModal(skipped?"skipped-actions":"",{day:today,hour,name})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flex:1,minWidth:0,background:skipped?"#f0faf6":"var(--bg-pill)",borderRadius:20,padding:"9px 14px",fontSize:14,color:skipped?"#00a86b":"var(--text-pill)",border:skipped?"1.5px dashed #a5d6a7":"none",cursor:past?"default":"pointer"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                                  <span style={{fontSize:11,color:skipped?"#a5d6a7":"#a09880",flexShrink:0}}>{i+1}</span>
                                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0,fontWeight:skipped?"bold":"normal"}}>{skipped?"Open":name}</span>
                                </div>
                                {!past&&(
                                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                                    {skipped&&<span style={{fontSize:18,color:"#00a86b"}}>●</span>}
                                    <span style={{fontSize:16,color:skipped?"#00a86b":"#a09880"}}>☰</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>)}
      </div>

      {/* ══ MODALS ══ */}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"var(--bg-modal-overlay)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:16}}
          onClick={e=>e.target===e.currentTarget&&setModal(null)}>

          {modal.type==="add"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🎾</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Add recurring player</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 20px",fontSize:13}}>{modal.day} at {fmt(modal.hour)} · repeats every week<br/><span style={{color:"var(--text-muted)"}}>You'll need your PIN to skip or cancel later.</span></p>
              <input placeholder="Your name" value={form.name} autoFocus onChange={e=>{setForm(f=>({...f,name:e.target.value.slice(0,20)}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,fontSize:15,border:"1.5px solid var(--border-input)",background:"var(--bg-input)",color:"#1a1a2e",marginBottom:10}}/>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 digits)" value={form.pin} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid var(--border-input)",background:"var(--bg-input)",color:"#1a1a2e",marginBottom:10}}/>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={4} placeholder="Confirm PIN" value={form.confirmPin} onKeyDown={e=>e.key==="Enter"&&handleAdd()} onChange={e=>{setForm(f=>({...f,confirmPin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <p style={{fontSize:11,color:"var(--text-muted)",textAlign:"center",margin:"0 0 12px",lineHeight:1.5}}>Your name and PIN are stored solely to manage your class bookings at Celbridge Padel Academy. This information is not shared with anyone.</p>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleAdd} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#f5f0e8",fontSize:14,fontWeight:"bold"}}>Book weekly slot</button>
              </div>
            </div>
          )}

          {modal.type==="sub-actions"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>{modal.repName}</h2>
              <p style={{color:"var(--text-secondary)",fontSize:13,margin:"0 0 20px"}}>{modal.day} at {fmt(modal.hour)} · subbing for {modal.originalName}</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <button onClick={()=>openModal("pin-remove-rep",{day:modal.day,hour:modal.hour,originalName:modal.originalName,repName:modal.repName,repPinHash:modal.repPinHash})} style={{width:"100%",padding:14,borderRadius:12,cursor:"pointer",background:"#fdecea",border:"none",color:"#c0392b",fontSize:15,fontWeight:"bold",textAlign:"left"}}>
                  ✕ Cancel this class
                </button>
                <button onClick={()=>setModal(null)} style={{width:"100%",padding:12,borderRadius:12,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#fff",fontSize:14}}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {modal.type==="skipped-actions"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>{modal.name}</h2>
              <p style={{color:"var(--text-secondary)",fontSize:13,margin:"0 0 20px"}}>{modal.day} {fmtDate(weekDates[modal.day])} at {fmt(modal.hour)} · skipping this week</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {!getReplacement(modal.day,modal.hour,modal.name)&&(
                  <button onClick={()=>openModal("add-rep",{day:modal.day,hour:modal.hour,originalName:modal.name})} style={{width:"100%",padding:14,borderRadius:12,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#fff",fontSize:15,fontWeight:"bold",textAlign:"left"}}>
                    🎾 Book this class
                  </button>
                )}
                <button onClick={()=>openModal("pin-undo-skip",{day:modal.day,hour:modal.hour,name:modal.name})} style={{width:"100%",padding:14,borderRadius:12,cursor:"pointer",background:"#00a86b",border:"none",color:"#fff",fontSize:15,fontWeight:"bold",textAlign:"left"}}>
                  ↺ Restore class
                </button>
                <button onClick={()=>setModal(null)} style={{width:"100%",padding:12,borderRadius:12,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#fff",fontSize:14}}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {modal.type==="player-actions"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>{modal.name}</h2>
              <p style={{color:"var(--text-secondary)",fontSize:13,margin:"0 0 20px"}}>{modal.day} {fmtDate(weekDates[modal.day])} at {fmt(modal.hour)}</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <button onClick={()=>openModal("pin-skip",{day:modal.day,hour:modal.hour,name:modal.name,action:"skip"})} style={{width:"100%",padding:14,borderRadius:12,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#fff",fontSize:15,fontWeight:"bold",textAlign:"left"}}>
                  🚫 Cancel this class
                </button>
                <button onClick={()=>openModal("pin-remove",{day:modal.day,hour:modal.hour,name:modal.name,action:"remove"})} style={{width:"100%",padding:14,borderRadius:12,cursor:"pointer",background:"#fdecea",border:"none",color:"#c0392b",fontSize:15,fontWeight:"bold",textAlign:"left"}}>
                  ⛔ Leave the academy
                </button>
                <button onClick={()=>setModal(null)} style={{width:"100%",padding:12,borderRadius:12,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#fff",fontSize:14}}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {modal.type==="pin-skip"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🗓️</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Skip this week?</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 4px",fontSize:13}}><strong>{modal.name}</strong> · {modal.day} at {fmt(modal.hour)}</p>
              <p style={{color:"var(--text-muted)",margin:"0 0 4px",fontSize:13}}>Enter your PIN to skip this week only. You'll be back automatically next week.</p>
              {adminPinHash&&<p style={{color:"#b8a898",margin:"0 0 16px",fontSize:12}}>Forgotten your PIN? Ask the coach to skip the class for you.</p>}
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handlePinVerify()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handlePinVerify} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Skip this week</button>
              </div>
            </div>
          )}

          {modal.type==="pin-remove"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:8}}>🚨</div>
              <div style={{background:"#fdecea",border:"1.5px solid #f4c2c2",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
                <p style={{margin:0,color:"#c0392b",fontWeight:"bold",fontSize:15}}>⚠ This will permanently remove your booking.</p>
                <p style={{margin:"6px 0 0",color:"#7a4040",fontSize:13}}><strong>{modal.name}</strong>'s recurring slot on {modal.day} at {fmt(modal.hour)} will be cancelled and opened up for someone else. This cannot be undone.</p>
              </div>
              <p style={{color:"var(--text-secondary)",margin:"0 0 4px",fontSize:13}}>Enter your PIN to confirm removal.</p>
              {adminPinHash&&<p style={{color:"#b8a898",margin:"0 0 16px",fontSize:12}}>Forgotten your PIN? Ask the coach to cancel the class for you.</p>}
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handlePinVerify()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handlePinVerify} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#c0392b",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Remove permanently</button>
              </div>
            </div>
          )}

          {modal.type==="confirm-remove"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>⚠️</div>
              <h2 style={{margin:"0 0 6px",fontSize:20}}>Are you sure?</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 20px",fontSize:13}}>This will permanently remove <strong>{modal.name}</strong>'s recurring booking for {modal.day} at {fmt(modal.hour)}. Their spot will open up for someone else.</p>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"var(--bg-tab)",border:"none",color:"var(--text-secondary)",fontSize:14}}>Keep it</button>
                <button onClick={()=>doRemove(modal.day,modal.hour,modal.name)} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#c0392b",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Yes, remove</button>
              </div>
            </div>
          )}

          {modal.type==="pin-undo-skip"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>↺</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Restore booking?</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 4px",fontSize:13}}>Enter <strong>{modal.name}</strong>'s PIN to return to this week's class.</p>
              {adminPinHash&&<p style={{color:"#b8a898",margin:"0 0 16px",fontSize:12}}>Forgotten your PIN? Ask the coach to restore the booking for you.</p>}
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handleUndoSkipVerify()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleUndoSkipVerify} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#f5f0e8",fontSize:14,fontWeight:"bold"}}>Restore</button>
              </div>
            </div>
          )}

          {modal.type==="add-rep"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🔄</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Add substitute</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 4px",fontSize:13}}>Filling in for <strong>{modal.originalName}</strong> · {modal.day} at {fmt(modal.hour)}</p>
              <p style={{color:"var(--text-muted)",margin:"0 0 18px",fontSize:12}}>This week only. Set a PIN to manage your booking.</p>
              <input placeholder="Your name" value={form.name} autoFocus onChange={e=>{setForm(f=>({...f,name:e.target.value.slice(0,20)}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,fontSize:15,border:"1.5px solid var(--border-input)",background:"var(--bg-input)",color:"#1a1a2e",marginBottom:10}}/>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 digits)" value={form.pin} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid var(--border-input)",background:"var(--bg-input)",color:"#1a1a2e",marginBottom:10}}/>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={4} placeholder="Confirm PIN" value={form.confirmPin} onKeyDown={e=>e.key==="Enter"&&handleAddReplacement()} onChange={e=>{setForm(f=>({...f,confirmPin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <p style={{fontSize:11,color:"var(--text-muted)",textAlign:"center",margin:"0 0 12px",lineHeight:1.5}}>Your name and PIN are stored solely to manage your class bookings at Celbridge Padel Academy. This information is not shared with anyone.</p>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleAddReplacement} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Pay €25 & confirm</button>
              </div>
            </div>
          )}

          {modal.type==="pin-remove-rep"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🔒</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Remove substitute?</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 4px",fontSize:13}}>Enter <strong>{modal.repName}</strong>'s PIN to remove this substitution.</p>
              <p style={{color:"#b8a898",margin:"0 0 16px",fontSize:12}}>Forgotten your PIN? Ask the coach to remove you.</p>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handleRemoveRepVerify()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleRemoveRepVerify} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#c0392b",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Remove sub</button>
              </div>
            </div>
          )}

          {modal.type==="open-slots-summary"&&(()=>{
            const detail = getOpenSlotsDetail(modal.days);

            function buildWhatsAppText() {
              const header = `*${modal.title} — Celbridge Padel Academy*\n${fmtDate(weekDates["Monday"])} – ${fmtDate(weekDates["Sunday"])}\n\n`;
              if(detail.length===0) return header + "✅ No open spots this week!\n\nhttps://celbridge-padel-academy.vercel.app/";
              return header + detail.map(({day,hour,empty,skippedNoSubNames})=>{
                let line = `📅 *${day} ${fmtDate(weekDates[day])} · ${fmt(hour)}*`;
                if(skippedNoSubNames.length) line += `\n⏸ Skipping: ${skippedNoSubNames.join(", ")}`;
                if(empty>0) line += `\n🟠 ${empty} unfilled ${empty===1?"spot":"spots"}`;
                return line;
              }).join("\n\n") + "\n\nhttps://celbridge-padel-academy.vercel.app/";
            }

            function shareWhatsApp() {
              const text = encodeURIComponent(buildWhatsAppText());
              window.open(`https://wa.me/?text=${text}`, "_blank");
            }

            return (
              <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:400,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
                <h2 style={{margin:"0 0 4px",fontSize:20}}>{modal.title}</h2>
                <p style={{color:"var(--text-secondary)",fontSize:13,margin:"0 0 16px"}}>{modal.days.length===1?fmtDate(weekDates[modal.days[0]]):fmtDate(weekDates["Monday"])+" – "+fmtDate(weekDates["Sunday"])}</p>
                {detail.length===0?(
                  <div style={{textAlign:"center",padding:"32px 0",color:"var(--text-muted)"}}>
                    <div style={{fontSize:32,marginBottom:8}}>✅</div>
                    <p style={{margin:0,fontSize:14}}>No open spots!</p>
                  </div>
                ):(
                  <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:10}}>
                    {detail.map(({day,hour,open,empty,skippedNoSubNames})=>(
                      <div key={`${day}-${hour}`} style={{background:"var(--bg-slot-empty)",borderRadius:12,padding:"12px 14px",border:"1.5px solid var(--border-summary-slot)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:skippedNoSubNames.length?8:0}}>
                          <span style={{fontWeight:"bold",fontSize:14,color:"var(--text-primary)"}}>{day} {fmtDate(weekDates[day])} · {fmt(hour)}</span>
                          <span style={{fontSize:12,background:open>0?"#fdecea":"#e8f5e9",color:open>0?"#c0392b":"#2e7d32",borderRadius:20,padding:"2px 10px",fontWeight:"bold"}}>{open} open</span>
                        </div>
                        {skippedNoSubNames.length>0&&(
                          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                            {skippedNoSubNames.map(n=>(
                              <span key={n} style={{fontSize:11,background:"var(--bg-page)",borderRadius:20,padding:"2px 8px",color:"#7a6050"}}>⏸ {n}</span>
                            ))}
                            {empty>0&&<span style={{fontSize:11,background:"#fdecea",borderRadius:20,padding:"2px 8px",color:"#c0392b"}}>{empty} unfilled {empty===1?"spot":"spots"}</span>}
                          </div>
                        )}
                        {skippedNoSubNames.length===0&&empty>0&&(
                          <span style={{fontSize:11,background:"#fdecea",borderRadius:20,padding:"2px 8px",color:"#c0392b"}}>{empty} unfilled {empty===1?"spot":"spots"}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:10,marginTop:16}}>
                  <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"var(--bg-tab)",border:"none",color:"var(--text-secondary)",fontSize:14}}>Close</button>
                  <button onClick={shareWhatsApp} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#25D366",border:"none",color:"#fff",fontSize:14,fontWeight:"bold",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                    <svg viewBox="0 0 32 32" width="18" height="18" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M16 3C8.82 3 3 8.82 3 16c0 2.3.6 4.5 1.7 6.4L3 29l6.8-1.7A13 13 0 0 0 16 29c7.18 0 13-5.82 13-13S23.18 3 16 3zm0 23.8a11.7 11.7 0 0 1-5.9-1.6l-.4-.25-4.04 1 1-3.93-.27-.42A11.8 11.8 0 1 1 16 26.8zm6.44-8.87c-.35-.18-2.08-1.03-2.4-1.14-.33-.12-.57-.18-.81.18-.24.35-.93 1.14-1.14 1.38-.2.23-.42.26-.77.09-.35-.18-1.48-.55-2.82-1.74-1.04-.93-1.75-2.08-1.95-2.43-.2-.35-.02-.54.15-.72.16-.16.35-.42.53-.63.18-.2.24-.35.35-.58.12-.23.06-.44-.03-.62-.09-.18-.81-1.95-1.11-2.67-.29-.7-.59-.6-.81-.61h-.69c-.24 0-.62.09-.94.44-.33.35-1.25 1.22-1.25 2.98s1.28 3.46 1.46 3.7c.18.23 2.52 3.85 6.1 5.4.85.37 1.52.59 2.03.75.86.27 1.63.23 2.25.14.69-.1 2.08-.85 2.37-1.67.3-.82.3-1.52.2-1.67-.08-.15-.32-.24-.67-.42z"/></svg>
                    Share on WhatsApp
                  </button>
                </div>
              </div>
            );
          })()}

          {modal.type==="admin-setup"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🔐</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Set coach PIN</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 20px",fontSize:13}}>First time using coach actions. Set a PIN (4–6 digits) that only you know.</p>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••••" value={form.pin} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:10}}/>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} placeholder="Confirm PIN" value={form.confirmPin} onKeyDown={e=>e.key==="Enter"&&handleAdminSetup()} onChange={e=>{setForm(f=>({...f,confirmPin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleAdminSetup} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#f5f0e8",fontSize:14,fontWeight:"bold"}}>Set PIN & continue</button>
              </div>
            </div>
          )}

          {modal.type==="admin-verify"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🔐</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Coach PIN required</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 18px",fontSize:13}}>Enter your coach PIN to {modal.action==="block"?`block ${modal.day}`:`unblock ${modal.day}`}.</p>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handleAdminVerify()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleAdminVerify} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#f5f0e8",fontSize:14,fontWeight:"bold"}}>Continue</button>
              </div>
            </div>
          )}

          {modal.type==="block-reason"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <div style={{fontSize:22,marginBottom:4}}>🔒</div>
              <h2 style={{margin:"0 0 4px",fontSize:20}}>Block {modal.day}?</h2>
              <p style={{color:"var(--text-secondary)",margin:"0 0 16px",fontSize:13}}>All classes on <strong>{modal.day}</strong> this week will be marked as cancelled. Add an optional reason.</p>
              <input placeholder="Reason (e.g. Bank holiday, Coach unavailable…)" value={form.name} autoFocus onChange={e=>setForm(f=>({...f,name:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter"){doBlockDay(modal.day,form.name);setModal(null);}}} style={{width:"100%",padding:"11px 14px",borderRadius:10,fontSize:14,border:"1.5px solid var(--border-input)",background:"var(--bg-input)",color:"#1a1a2e",marginBottom:16}}/>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={()=>{doBlockDay(modal.day,form.name);setModal(null);}} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#c0392b",border:"none",color:"#fff",fontSize:14,fontWeight:"bold"}}>Block day</button>
              </div>
            </div>
          )}

          {modal.type==="admin-verify-edit-level"&&(
            <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:340,animation:"popIn 0.2s ease",boxShadow:"0 24px 80px rgba(0,0,0,0.2)"}}>
              <input className="pin-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="••••••" value={form.pin} onKeyDown={e=>e.key==="Enter"&&handleAdminVerifyEditLevel()} onChange={e=>{setForm(f=>({...f,pin:e.target.value.replace(/\D/,"")}));setPinError("");}} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${pinError?"#e74c3c":"#ddd6c8"}`,background:"var(--bg-input)",color:"#1a1a2e",marginBottom:pinError?6:16}}/>
              {pinError&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px"}}>⚠ {pinError}</p>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setModal(null)} style={{flex:1,padding:11,borderRadius:10,cursor:"pointer",background:"#1a1a2e",border:"none",color:"#ffffff",fontSize:14}}>Cancel</button>
                <button onClick={handleAdminVerifyEditLevel} style={{flex:2,padding:11,borderRadius:10,cursor:"pointer",background:"#2B4EFF",border:"none",color:"#f5f0e8",fontSize:14,fontWeight:"bold"}}>Continue</button>
              </div>
            </div>
          )}

        </div>
      )}

      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#2B4EFF",color:"#f5f0e8",padding:"12px 22px",borderRadius:30,fontSize:14,boxShadow:"0 8px 32px rgba(0,0,0,0.25)",animation:"toastSlide 0.3s ease",whiteSpace:"nowrap",borderLeft:toast.type==="err"?"4px solid #e74c3c":"4px solid #c8e84a"}}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
