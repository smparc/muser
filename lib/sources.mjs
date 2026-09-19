// The places a Muse may gather facts from, each with what it may take. Owners authorize these individually during
// onboarding (and later on the Profile page); nothing is authorized by default.
export const SOURCES=[
 {id:'owner',group:'You',label:'What you tell your Muse',may_use:'Facts you tell your Muse yourself and ask it to share.'},
 {id:'google_calendar',group:'Google',label:'Google Calendar',may_use:'Recurring activities, classes, clubs and events you take part in. Never who you meet, other people\'s names, or exact places and times.'},
 {id:'gmail',group:'Google',label:'Gmail',may_use:'The topics of projects, work and communities you are involved in. Never message contents, senders or recipients.'},
 {id:'google_drive',group:'Google',label:'Google Drive',may_use:'The topics of documents you wrote (projects, research, writing). Never document contents or files other people shared with you.'},
 {id:'facebook',group:'Meta',label:'Facebook',may_use:'Interests, pages and groups on your own profile. Never friends, messages or other people\'s posts.'},
 {id:'instagram',group:'Meta',label:'Instagram',may_use:'Hobbies and interests shown in your own posts. Never the people in them or where they were taken.'},
 {id:'linkedin',group:'Professional',label:'LinkedIn',may_use:'Your current role, work history, skills and education.'},
 {id:'github',group:'Public profiles',label:'GitHub',may_use:'Your public repositories, the languages you use and projects you contribute to.'},
 {id:'x',group:'Public profiles',label:'X (Twitter)',may_use:'Topics you post about publicly. Never replies to or from specific people.'},
];
export const SOURCE_IDS=SOURCES.map(s=>s.id);
const byId=new Map(SOURCES.map(s=>[s.id,s]));
export const sourceLabel=id=>byId.get(id)?.label??id;
// What a Muse is told: only the sources its owner authorized, with the limits of each.
export const describeSources=ids=>ids.filter(id=>byId.has(id)).map(id=>{const s=byId.get(id);return {id:s.id,label:s.label,may_use:s.may_use};});
