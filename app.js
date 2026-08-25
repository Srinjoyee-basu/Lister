const c=window.LISTER_CONFIG||{};
const configured=!!(c.SUPABASE_URL&&c.SUPABASE_PUBLISHABLE_KEY);
const sb=configured?window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_PUBLISHABLE_KEY):null;

let user=null,items=[],saved=new Set(),cat="All",query="",editingItemId=null;

const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
function generateTags(name, description, category) {
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your",
    "you", "are", "was", "were", "have", "has", "had", "its",
    "into", "about", "just", "than", "then", "very", "more",
    "less", "what", "when", "where", "why", "how", "a", "an"
  ]);

  const categoryTags = {
    Cars: ["car", "automotive"],
    Tech: ["technology"],
    Fashion: ["fashion", "style"],
    Books: ["book", "reading"],
    Music: ["music", "audio"],
    Objects: ["object", "design"],
    Other: []
  };

  const text = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ");

  const words = text
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word =>
      word.length >= 3 &&
      word.length <= 24 &&
      !stopWords.has(word) &&
      !/^\d+$/.test(word)
    );

  const uniqueWords = [...new Set(words)];

  const tags = [
    ...(categoryTags[category] || []),
    ...uniqueWords
  ];

  return [...new Set(tags)]
    .slice(0, 8);
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[x]));
}
function toast(message){
  const el=$("#toast");if(!el)return;
  el.textContent=message;el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.classList.remove("show"),2300);
}
function authRequired(action){
  if(user)return true;
  $("#authModal")?.classList.add("open");
  toast("Sign in to "+action);
  return false;
}
function setModal(id,open){
  const el=$("#"+id);if(!el)return;
  el.classList.toggle("open",open);
  el.setAttribute("aria-hidden",String(!open));
}

async function init(){
  if(!sb){toast("Add your Supabase keys to config.js");return}
  const {data,error}=await sb.auth.getSession();
  if(error)console.error(error);
  user=data?.session?.user||null;
  updateAuth();
  sb.auth.onAuthStateChange((_event,session)=>{
    user=session?.user||null;
    updateAuth();
    loadSaved();
  });
  await loadItems();
  await loadSaved();
}

function updateAuth(){
  const login=$("#loginBtn"),avatar=$("#profileBtn");
  if(login)login.hidden=!!user;
  if(avatar){
    avatar.hidden=!user;
    if(user){
      const name=user.user_metadata?.full_name||user.user_metadata?.name||user.email||"U";
      avatar.textContent=name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();
    }
  }
}

async function login(){
  if(!sb){toast("Supabase is not configured");return}
  const {error}=await sb.auth.signInWithOAuth({
    provider:"google",
    options:{redirectTo:window.location.origin+"/"}
  });
  if(error)toast(error.message);
}

async function logout(){
  if(!sb)return;
  const {error}=await sb.auth.signOut();
  if(error){toast(error.message);return}
  user=null;saved.clear();updateAuth();render();renderSaved();toast("Signed out");
}

async function loadItems(){
  if(!sb)return;
  const {data,error}=await sb.from("items")
    .select("*,profiles:user_id(display_name,username,avatar_url),item_votes(count)")
    .order("created_at",{ascending:false});
  if(error){console.error(error);toast(error.message);return}
  items=(data||[]).map(x=>({
    ...x,
    likes:x.item_votes?.[0]?.count||0,
    user:x.profiles?.username?"@"+x.profiles.username:x.profiles?.display_name||"@user"
  }));
  render();renderSaved();
}

async function loadSaved(){
  if(!sb||!user){saved.clear();render();renderSaved();return}
  const {data,error}=await sb.from("saved_items").select("item_id").eq("user_id",user.id);
  if(error){console.error(error);return}
  saved=new Set((data||[]).map(x=>x.item_id));render();renderSaved();
}

function filtered(){
  const q=query.trim().toLowerCase();
  return items.filter(x=>{
    const hay=[x.name,x.description,x.category,...(x.tags||[]),x.user].join(" ").toLowerCase();
    return (cat==="All"||x.category===cat)&&hay.includes(q);
  });
}

function card(x){
  const image = x.image_url
    ? `<img src="${esc(x.image_url)}" alt="${esc(x.name)}" onerror="this.parentElement.innerHTML='◈'">`
    : "◈";

  const description = x.description || "";
  const maxLength = 120;
  const isLong = description.length > maxLength;

  const shortDescription = isLong
    ? description.slice(0, maxLength).trim() + "..."
    : description;

  return `<article class="card" data-id="${esc(x.id)}">
    <div class="thumb">${image}</div>

    <div class="body">
      <div class="cat">${esc(x.category).toUpperCase()}</div>
      <h3>${esc(x.name)}</h3>

      <p class="item-description"
         data-short="${esc(shortDescription)}"
         data-full="${esc(description)}">
        ${esc(shortDescription)}
      </p>

      ${isLong ? `
        <button class="read-more-btn" type="button">
          Read more
        </button>
      ` : ""}

      <div class="tags">
        ${(x.tags||[])
          .map(t => `<span class="tag">#${esc(t)}</span>`)
          .join("")}
      </div>
    </div>

    <div class="foot">
      <span>${esc(x.user||"@user")}</span>

      <button
        class="like ${saved.has(x.id) ? "saved" : ""}"
        data-save="${esc(x.id)}"
        type="button">
        ${saved.has(x.id) ? "♥" : "♡"} ${x.likes||0}
      </button>
    </div>
  </article>`;
}
function wireCards(container){
  container.querySelectorAll(".card").forEach(el=>{
    el.onclick=e=>{
      if(
        e.target.closest("[data-save]") ||
        e.target.closest(".read-more-btn")
      ) return;

      detail(el.dataset.id);
    };
  });

  container.querySelectorAll("[data-save]").forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      toggleSave(btn.dataset.save);
    };
  });

  container.querySelectorAll(".read-more-btn").forEach(button=>{
    button.onclick=e=>{
      e.stopPropagation();

      const description = button
        .closest(".body")
        .querySelector(".item-description");

      const expanded = button.dataset.expanded === "true";

      if(expanded){
        description.textContent = description.dataset.short;
        button.textContent = "Read more";
        button.dataset.expanded = "false";
      }else{
        description.textContent = description.dataset.full;
        button.textContent = "Show less";
        button.dataset.expanded = "true";
      }
    };
  });
}
function render(){
  const grid=$("#grid");if(!grid)return;
  const arr=filtered();
  grid.innerHTML=arr.map(card).join("");
  $("#count")&&( $("#count").textContent=`${arr.length} ${arr.length===1?"item":"items"}` );
  $("#empty")&&( $("#empty").hidden=arr.length>0 );
  grid.hidden=arr.length===0;
  wire(grid);
}

function renderSaved(){
  const grid=$("#savedGrid"),empty=$("#savedEmpty");
  if(!grid||!empty)return;
  const arr=items.filter(x=>saved.has(x.id));
  grid.innerHTML=arr.map(card).join("");
  grid.hidden=arr.length===0;
  empty.hidden=arr.length>0;
  wire(grid);
}

async function toggleSave(id){
  if(!authRequired("save things"))return;
  if(saved.has(id)){
    const {error}=await sb.from("saved_items").delete().eq("item_id",id).eq("user_id",user.id);
    if(error){toast(error.message);return}
    saved.delete(id);toast("Removed from Saved");
  }else{
    const {error}=await sb.from("saved_items").insert({item_id:id,user_id:user.id});
    if(error){toast(error.message);return}
    saved.add(id);toast("Saved");
  }
  render();renderSaved();
}

function detail(id){
  const x=items.find(i=>i.id===id);
  if(!x)return;

  const owner=!!user&&user.id===x.user_id;
  const el=$("#itemDetail");

  if(!el)return;

  el.innerHTML=`
    <button class="modal-close" id="detailClose" type="button">×</button>

    ${
      x.image_url
        ? `<img
            class="detail-img"
            src="${esc(x.image_url)}"
            alt="${esc(x.name)}"
            onerror="this.style.display='none'"
          >`
        : `<div class="detail-icon">◈</div>`
    }

    <div class="detail">

      <div class="eyebrow">
        <span></span>
        ${esc(x.category||"OTHER")}
      </div>

      <h2>${esc(x.name)}</h2>

      <p class="muted">
        ${esc(x.description)}
      </p>

      <p class="muted">
        Added by <b>${esc(x.user)}</b>
      </p>

      <div class="tags">
        ${(x.tags||[])
          .map(t=>`<span class="tag">#${esc(t)}</span>`)
          .join("")}
      </div>

      <div class="detail-actions">

        <button
          class="primary"
          id="detailSave"
          type="button"
        >
          ${saved.has(x.id)?"♥ Saved":"♡ Save"}
        </button>

        <button
          class="secondary"
          id="addToListBtn"
          type="button"
        >
          ＋ Add to List
        </button>

        ${
          x.source_url
            ? `<a
                class="secondary"
                href="${esc(x.source_url)}"
                target="_blank"
                rel="noopener"
              >
                Visit source ↗
              </a>`
            : ""
        }

        ${
          owner?`
        <button class="secondary" id="editItem" type="button">✎ Edit</button>
        <button class="delete-btn" id="deleteItem" type="button">Delete</button>
    `:""}

      </div>

      <div id="listPicker"></div>

    </div>
  `;

  setModal("itemModal",true);

  $("#detailClose").onclick=()=>{
    setModal("itemModal",false);
  };

  $("#detailSave").onclick=()=>{
    toggleSave(x.id);
  };

  $("#addToListBtn").onclick=()=>{
    showListPicker(x.id);
  };

  if(owner){
  $("#editItem").onclick=()=>editItem(x.id);
  $("#deleteItem").onclick=()=>deleteItem(x.id);
}
}
async function showListPicker(itemId){

  if(!authRequired("add things to lists"))return;

  const picker=$("#listPicker");

  if(!picker)return;

  picker.innerHTML=`
    <div class="list-picker">
      <p class="tiny">ADD TO LIST</p>
      <p class="muted">Loading your lists...</p>
    </div>
  `;

  const {data,error}=await sb
    .from("lists")
    .select("id,title,description")
    .eq("user_id",user.id)
    .order("created_at",{ascending:false});

  if(error){
    console.error(error);
    toast(error.message);
    return;
  }

  if(!data||data.length===0){

    picker.innerHTML=`
      <div class="list-picker">

        <p class="tiny">ADD TO LIST</p>

        <p class="muted">
          You don't have any lists yet.
        </p>

        <button
          class="primary"
          id="createListFromItem"
          type="button"
        >
          + Create a List
        </button>

      </div>
    `;

    $("#createListFromItem").onclick=async()=>{
      await newList();
      await showListPicker(itemId);
    };

    return;
  }

  picker.innerHTML=`
    <div class="list-picker">

      <p class="tiny">ADD TO LIST</p>

      <div class="list-picker-options">

        ${data.map(list=>`
          <button
            class="list-option"
            type="button"
            data-list-id="${esc(list.id)}"
          >
            <strong>${esc(list.title)}</strong>
            <span>${esc(list.description||"")}</span>
          </button>
        `).join("")}

      </div>

      <button
        class="secondary"
        id="createListFromItem"
        type="button"
      >
        + Create a new list
      </button>

    </div>
  `;

  picker
    .querySelectorAll("[data-list-id]")
    .forEach(btn=>{

      btn.onclick=async()=>{

        const listId=btn.dataset.listId;

        const {error}=await sb
          .from("list_items")
          .insert({
            list_id:listId,
            item_id:itemId
          });

        if(error){

          if(
            error.code==="23505" ||
            error.message?.toLowerCase().includes("duplicate")
          ){
            toast("Already in this list");
          }else{
            console.error(error);
            toast(error.message);
          }

          return;
        }

        toast("Added to list ✦");

        picker.innerHTML=`
          <div class="list-picker">
            <p class="muted">
              ✓ Added to your list
            </p>
          </div>
        `;
      };

    });


  $("#createListFromItem").onclick=async()=>{
    await newList();
    await showListPicker(itemId);
  };
}

function editItem(id){
  const item=items.find(x=>x.id===id);

  if(!item){
    toast("Couldn't find this item");
    return;
  }

  if(!user || item.user_id!==user.id){
    toast("You can only edit your own items");
    return;
  }

  editingItemId=id;

  const form=$("#itemForm");

  form.elements.name.value=item.name||"";
  form.elements.description.value=item.description||"";
  form.elements.category.value=item.category||"Other";
  form.elements.tags.value=(item.tags||[]).join(", ");
  form.elements.url.value=item.source_url||"";
  form.elements.image.value=item.image_url||"";

  $("#addTitle").innerHTML="Edit your<br><em>discovery.</em>";

  const submitButton=form.querySelector(".submit-btn");
  submitButton.innerHTML="Save changes <span>✓</span>";

  setModal("itemModal",false);
  setModal("modal",true);
}

async function deleteItem(id){
  if(!user)return;
  const x=items.find(i=>i.id===id);
  if(!x||x.user_id!==user.id){toast("You can only delete your own items");return}
  if(!confirm(`Delete "${x.name}" permanently?`))return;
  const {error}=await sb.from("items").delete().eq("id",id).eq("user_id",user.id);
  if(error){toast(error.message);return}
  setModal("itemModal",false);toast("Deleted");await loadItems();
}

async function addItem(e){
  e.preventDefault();

  if(!authRequired("publish things")) return;

  const f=new FormData(e.target);

  const row={
    name:String(f.get("name")||"").trim(),
    description:String(f.get("description")||"").trim(),
    category:String(f.get("category")||"Other"),
    tags:String(f.get("tags")||"")
      .split(",")
      .map(x=>x.trim())
      .filter(Boolean),
    source_url:String(f.get("url")||"").trim()||null,
    image_url:String(f.get("image")||"").trim()||null
  };

  if(!row.name||!row.description){
    toast("Name and description are required");
    return;
  }

  let error;

  if(editingItemId){
    const result=await sb
      .from("items")
      .update(row)
      .eq("id",editingItemId)
      .eq("user_id",user.id);

    error=result.error;
  }else{
    const result=await sb
      .from("items")
      .insert({
        ...row,
        user_id:user.id
      });

    error=result.error;
  }

  if(error){
    console.error(error);
    toast(error.message);
    return;
  }

  const wasEditing=!!editingItemId;

  editingItemId=null;
  e.target.reset();

  $("#addTitle").innerHTML="Put something<br><em>on the map.</em>";

  const submitButton=e.target.querySelector(".submit-btn");
  submitButton.innerHTML="Publish to Lister <span>↗</span>";

  setModal("modal",false);

  toast(wasEditing ? "Changes saved ✓" : "Published to Lister ✦");

  await loadItems();
  await loadSaved();
}

async function loadLists(){
  if(!sb)return;

  const {data,error}=await sb.from("lists")
    .select("*,profiles:user_id(display_name,username),list_items(count)")
    .order("created_at",{ascending:false});

  if(error){
    console.error(error);
    toast(error.message);
    return;
  }

  const grid=$("#listGrid");
  if(!grid)return;

  grid.innerHTML=(data||[]).map(l=>`
    <article
      class="list-card"
      data-list-id="${esc(l.id)}"
      tabindex="0"
      role="button"
      aria-label="Open ${esc(l.title)}"
    >
      <div class="list-art">◈</div>

      <h3>${esc(l.title)}</h3>

      <p>
        ${l.list_items?.[0]?.count||0} items ·
        ${esc(
          l.profiles?.username
            ? "@"+l.profiles.username
            : l.profiles?.display_name||"@user"
        )}
      </p>

      <p>${esc(l.description||"")}</p>
    </article>
  `).join("");

  grid.querySelectorAll(".list-card").forEach(card=>{
    const open=()=>openList(card.dataset.listId);

    card.addEventListener("click",open);

    card.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        open();
      }
    });
  });
}


async function openList(listId){
  if(!sb||!listId)return;

  const modal=$("#itemModal");
  const el=$("#itemDetail");

  if(!modal||!el)return;

  el.innerHTML=`
    <div class="detail">
      <p class="muted">Loading list…</p>
    </div>
  `;

  setModal("itemModal",true);

  // Get the list
  const {data:list,error:listError}=await sb
    .from("lists")
    .select("*,profiles:user_id(display_name,username)")
    .eq("id",listId)
    .single();

  if(listError||!list){
    console.error(listError);
    toast("Couldn't open this list");
    setModal("itemModal",false);
    return;
  }

  // Get the items belonging to this list
  const {data:links,error:linksError}=await sb
    .from("list_items")
    .select("item_id")
    .eq("list_id",listId);

  if(linksError){
    console.error(linksError);
    toast(linksError.message);
    setModal("itemModal",false);
    return;
  }

  const ids=(links||[])
    .map(x=>x.item_id)
    .filter(Boolean);

  let listItems=[];

  // Load the actual items
  if(ids.length){

    const {data:rows,error:itemsError}=await sb
      .from("items")
      .select(
        "*,profiles:user_id(display_name,username,avatar_url),item_votes(count)"
      )
      .in("id",ids);

    if(itemsError){
      console.error(itemsError);
      toast(itemsError.message);
      setModal("itemModal",false);
      return;
    }

    const byId=new Map(
      (rows||[]).map(x=>[x.id,x])
    );

    // Keep the same order as list_items
    listItems=ids
      .map(id=>byId.get(id))
      .filter(Boolean)
      .map(x=>({
        ...x,
        likes:x.item_votes?.[0]?.count||0,
        user:x.profiles?.username
          ? "@"+x.profiles.username
          : x.profiles?.display_name||"@user"
      }));
  }

  const owner=
    !!user &&
    user.id===list.user_id;

  const author=list.profiles?.username
    ? "@"+list.profiles.username
    : list.profiles?.display_name||"@user";


  // Display the list
  el.innerHTML=`

    <button
      class="modal-close"
      id="listClose"
      type="button"
    >
      ×
    </button>

    <div class="detail">

      <div class="eyebrow">
        <span></span>
        CURATED LIST
      </div>

      <h2>
        ${esc(list.title)}
      </h2>

      <p class="muted">
        ${esc(list.description||"")}
      </p>

      <p class="muted">
        ${listItems.length}
        ${listItems.length===1?"item":"items"}
        · by <b>${esc(author)}</b>
      </p>


      <div class="list-detail-items">

        ${
          listItems.length

          ?

          listItems.map(x=>`

            <article
              class="list-item-row"
              data-item-id="${esc(x.id)}"
              tabindex="0"
              role="button"
            >

              <div class="list-item-thumb">

                ${
                  x.image_url

                  ?

                  `<img
                    src="${esc(x.image_url)}"
                    alt="${esc(x.name)}"
                    onerror="this.style.display='none'"
                  >`

                  :

                  "◈"
                }

              </div>


              <div>

                <div class="cat">
                  ${esc(
                    x.category||"OTHER"
                  ).toUpperCase()}
                </div>

                <h3>
                  ${esc(x.name)}
                </h3>

                <p>
                  ${esc(x.description||"")}
                </p>

              </div>

            </article>

          `).join("")

          :

          `

          <div
            class="empty"
            style="padding:35px 10px"
          >

            <div>◈</div>

            <h3>
              This list is empty.
            </h3>

            <p>
              There aren't any items
              in this list yet.
            </p>

          </div>

          `
        }

      </div>


      ${
        owner

        ?

        `<p
          class="tiny"
          style="margin-top:18px"
        >
          You created this list.
        </p>`

        :

        ""
      }

    </div>
  `;


  // Close button
  $("#listClose").onclick=()=>{
    setModal("itemModal",false);
  };


  // Make items inside the list clickable
  el.querySelectorAll(".list-item-row")
    .forEach(row=>{

      const open=()=>{
        detail(row.dataset.itemId);
      };

      row.addEventListener(
        "click",
        open
      );

      row.addEventListener(
        "keydown",
        e=>{
          if(
            e.key==="Enter" ||
            e.key===" "
          ){
            e.preventDefault();
            open();
          }
        }
      );

    });
}

async function newList(){
  if(!authRequired("create lists"))return;
  const title=prompt("List title");if(!title)return;
  const description=prompt("Short description")||"";
  const {error}=await sb.from("lists").insert({user_id:user.id,title:title.trim(),description:description.trim()});
  if(error){toast(error.message);return}
  toast("List created");loadLists();
}

function view(name){
  $("#exploreView")&&( $("#exploreView").hidden=name!=="explore" );
  $("#listsView")&&( $("#listsView").hidden=name!=="lists" );
  $("#savedView")&&( $("#savedView").hidden=name!=="saved" );
  if(name==="explore")render();
  if(name==="saved")renderSaved();
  if(name==="lists")loadLists();
}

$$(".nav-link").forEach(b=>b.onclick=()=>{
  $$(".nav-link").forEach(x=>x.classList.remove("active"));b.classList.add("active");view(b.dataset.view);
});
$$(".chip").forEach(b=>b.onclick=()=>{
  $$(".chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");cat=b.dataset.cat;render();
});
$("#search")?.addEventListener("input",e=>{query=e.target.value;render()});
$("#focusSearch")?.addEventListener("click",()=>$("#search")?.focus());

$("#loginBtn")?.addEventListener("click",()=>setModal("authModal",true));
$("#googleBtn")?.addEventListener("click",login);
$("#authClose")?.addEventListener("click",()=>setModal("authModal",false));
$("#profileBtn")?.addEventListener("click",()=>{if(confirm("Sign out of Lister?"))logout()});

const openAdd=()=>{
  if(!authRequired("publish things")) return;

  editingItemId=null;

  const form=$("#itemForm");
  form.reset();

  $("#addTitle").innerHTML="Put something<br><em>on the map.</em>";

  const submitButton=form.querySelector(".submit-btn");
  submitButton.innerHTML="Publish to Lister <span>↗</span>";

  setModal("modal",true);
};
$("#addBtn")?.addEventListener("click",openAdd);
$("#emptyAdd")?.addEventListener("click",openAdd);
$("#close")?.addEventListener("click",()=>setModal("modal",false));
$("#itemForm")?.addEventListener("submit",addItem);
$("#newList")?.addEventListener("click",newList);

$$(".modal-backdrop").forEach(b=>b.addEventListener("click",e=>{
  if(e.target===b)b.classList.remove("open");
}));
document.addEventListener("keydown",e=>{
  if(e.key==="Escape")$$(".modal-backdrop").forEach(x=>x.classList.remove("open"));
  if(e.key==="/"&&document.activeElement!==$("#search")){e.preventDefault();$("#search")?.focus()}
});
const itemForm = $("#itemForm");

if (itemForm) {
  const nameInput = itemForm.elements.name;
  const descriptionInput = itemForm.elements.description;
  const categoryInput = itemForm.elements.category;
  const tagsInput = itemForm.elements.tags;

  let tagTimer;

  function updateAutoTags() {
    clearTimeout(tagTimer);

    tagTimer = setTimeout(() => {
      const name = nameInput.value.trim();
      const description = descriptionInput.value.trim();
      const category = categoryInput.value;

      if (!name && !description) return;

      const generatedTags = generateTags(
        name,
        description,
        category
      );

      tagsInput.value = generatedTags.join(", ");
    }, 500);
  }

  nameInput.addEventListener("input", updateAutoTags);
  descriptionInput.addEventListener("input", updateAutoTags);
  categoryInput.addEventListener("change", updateAutoTags);
}
init();
