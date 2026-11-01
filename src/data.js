export const id=()=>crypto.randomUUID();
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const text=(value,marks)=>({type:'text',text:value,...(marks?{marks}:{})});
export const p=(value='')=>({type:'paragraph',...(value?{content:[text(value)]}:{})});
export const heading=(value,level=2)=>({type:'heading',attrs:{level},content:[text(value)]});
export const task=(value,checked=false,due=null)=>({type:'taskItem',attrs:{checked,due},content:[p(value)]});
export const contentText=n=>(n?.text||'')+(n?.content?.map(contentText).join(n.type==='doc'?'\n':' ')||'');
export function seed(){
 const space=id(),folder=id(),ideas=id();const make=(title,emoji,cover,content,extra={})=>({id:id(),title,emoji,cover,content:{type:'doc',content},space,folder:null,tags:[],created:Date.now(),updated:Date.now(),...extra});
 const welcome=make('A little room for big ideas','✦','sage',[
  p('YOUR PERSONAL WORKSPACE'),heading('Make space for what matters.',1),p('A thought, a plan, the beginning of something good. Folio is a quiet place to bring it all together.'),
  heading('Start with a thought'),p('Click anywhere and make this page your own. Type / for blocks, or use the formatting toolbar. Every change is saved on this computer.'),
  {type:'blockquote',content:[p('The secret of getting ahead is getting started.')]},
  heading('A few things to try'),{type:'taskList',content:[task('Write something you want to remember'),task('Create a daily note'),task('Make a collection for your next project')]},
  heading('Your ideas belong to you'),p('Your documents, attachments, collections, and boards stay on this PC. Export a workspace backup from Settings whenever you want to take a copy with you.')
 ],{starred:true,tags:['welcome']});
 const journal=make('Small things, worth noticing','☀','sand',[p('A place to collect the good bits.'),heading('Outside the usual'),p('A slower morning. An interesting conversation. An idea that arrived while doing something else.'),heading('Keep a little list'),{type:'bulletList',content:[{type:'listItem',content:[p('Something that surprised me')]},{type:'listItem',content:[p('Something I learned')]},{type:'listItem',content:[p('Something to look forward to')]}]}],{folder,tags:['personal']});
 const project=make('The next chapter','↗','lavender',[heading('A good project starts with a question.'),p('What would I make if I gave myself the space to try?'),heading('The shape of it'),p('Collect references. Explore a few directions. Keep the best ideas close.'),{type:'taskList',content:[task('Gather inspiration',true),task('Sketch a first direction',false,today()),task('Make something small and share it')]}],{folder:ideas,starred:true,tags:['ideas']});
 const collection=make('Things to explore','◈','blue',[p('A living list of books, places, ideas, and everything in between.')],{kind:'collection',columns:[{id:'name',name:'Name',type:'text'},{id:'status',name:'Status',type:'select'},{id:'date',name:'Date',type:'date'},{id:'tags',name:'Tags',type:'text'}],rows:[{id:id(),name:'A new creative practice',status:'In progress',date:today(),tags:'Creative'},{id:id(),name:'A weekend somewhere quiet',status:'Someday',date:'',tags:'Travel'},{id:id(),name:'A book that changes my mind',status:'To do',date:'',tags:'Reading'}]});
 const board=make('Room to think','〰','rose',[],{kind:'board',board:{strokes:[],notes:[{id:id(),x:110,y:100,text:'What if we made a little more room for curiosity?',color:'#fff0b9'},{id:id(),x:430,y:220,text:'Collect the sparks.\nConnect them later.',color:'#dcebdc'}]}});
 return {version:1,spaces:[{id:space,name:'Personal space',emoji:'◒'}],folders:[{id:folder,name:'Personal',space,parent:null},{id:ideas,name:'Projects & ideas',space,parent:null}],docs:[welcome,journal,project,collection,board],settings:{theme:'light',font:'sans',wide:false},activeSpace:space};
}
export const templates=[
 {name:'Blank page',emoji:'✦',description:'A little space for anything.',content:[p()]},
 {name:'Meeting notes',emoji:'↗',description:'Good conversations, clear next steps.',content:[heading('Agenda'),p('What are we here to discuss?'),heading('Notes'),p(),heading('Next steps'),{type:'taskList',content:[task('Add an action item')]}]},
 {name:'Weekly reflection',emoji:'☀',description:'Look back. Find your next direction.',content:[heading('The good things'),p(),heading('What I learned'),p(),heading('Next week'),{type:'taskList',content:[task('One thing to focus on')]}]},
 {name:'Project brief',emoji:'◈',description:'Give your next big idea a home.',content:[heading('The idea'),p('What are we making, and why?'),heading('What success looks like'),p(),heading('Milestones'),{type:'taskList',content:[task('Explore'),task('Make'),task('Refine')]},heading('References'),p()]},
 {name:'Reading notes',emoji:'▤',description:'Keep the ideas that stay with you.',content:[heading('About the book'),p('Author · Started · Finished'),heading('Ideas to keep'),p(),heading('A favorite passage'),{type:'blockquote',content:[p('Add a quote here.')]},heading('My take'),p()]},
 {name:'Daily journal',emoji:'✺',description:'Notice the little things.',content:[heading('On my mind'),p(),heading('Today’s intention'),p(),heading('A little gratitude'),p()]}
];
export function toMarkdown(node,depth=0){
 if(!node)return '';if(node.type==='text'){let s=node.text;for(const m of node.marks||[]){if(m.type==='bold')s=`**${s}**`;if(m.type==='italic')s=`*${s}*`;if(m.type==='code')s='`'+s+'`';if(m.type==='link')s=`[${s}](${m.attrs.href})`;}return s;}
 const body=(node.content||[]).map(n=>toMarkdown(n,depth+1)).join('');
 switch(node.type){case'doc':return body;case'heading':return '#'.repeat(node.attrs.level)+' '+body+'\n\n';case'paragraph':return body+'\n\n';case'blockquote':return body.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';case'listItem':return '- '+body.trim()+'\n';case'taskItem':return `- [${node.attrs.checked?'x':' '}] ${body.trim()}${node.attrs.due?' (due '+node.attrs.due+')':''}\n`;case'codeBlock':return '```'+(node.attrs.language||'')+'\n'+body+'\n```\n\n';case'hardBreak':return '\n';case'horizontalRule':return '\n---\n\n';case'image':return `![${node.attrs.alt||''}](${node.attrs.src})\n\n`;case'noteLink':return `[[${node.attrs.title}]]`;case'attachment':return `[${node.attrs.name}](${node.attrs.src})\n\n`;case'tableRow':return '| '+(node.content||[]).map(c=>contentText(c)).join(' | ')+' |\n';default:return body;}
}
