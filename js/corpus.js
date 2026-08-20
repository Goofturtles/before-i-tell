/* corpus.js — DATA ONLY. The L1 "Ask" knowledge base.
   Jurisdiction: Ontario, Canada. Every entry cites its source.
   Sources (verified):
   - OACAS, Duty to Report: https://www.oacas.org/childrens-aid-child-protection/duty-to-report/
   - Ontario College of Teachers, Professional Advisory — Duty to Report:
     https://www.oct.ca/en-ca/for-members/professional-advisories/duty-to-report
   - IPC Ontario, Disclosure to a children's aid society:
     https://www.ipc.on.ca/en/education/special-topics/disclosure-to-a-childrens-aid-society
   - Kids Help Phone: https://kidshelpphone.ca/

   Honesty rule: if it isn't in this file, the app says "I don't know."
   Answers use plain language, short sentences, no euphemism, no alarm. */

const CITE = {
  oacas: { label: "OACAS — Duty to Report", url: "https://www.oacas.org/childrens-aid-child-protection/duty-to-report/" },
  oct:   { label: "Ontario College of Teachers — Professional Advisory", url: "https://www.oct.ca/en-ca/for-members/professional-advisories/duty-to-report" },
  ipc:   { label: "IPC Ontario — Disclosure to a children's aid society", url: "https://www.ipc.on.ca/en/education/special-topics/disclosure-to-a-childrens-aid-society" },
  khp:   { label: "Kids Help Phone", url: "https://kidshelpphone.ca/" },
  ont:   { label: "Ontario — Bullying: we can all help stop it", url: "https://www.ontario.ca/page/bullying-we-can-all-help-stop-it" },
};

export const SYNONYMS = {
  // people
  cops: "police", cop: "police", "5-0": "police",
  mom: "parents", mum: "parents", dad: "parents", parent: "parents",
  guardian: "parents", guardians: "parents", family: "parents",
  counselor: "counsellor", councilor: "counsellor", councillor: "counsellor",
  therapist: "counsellor", shrink: "counsellor",
  prof: "teacher", teachers: "teacher", coach: "teacher", principal: "teacher", vp: "teacher",
  // orgs
  cas: "childrens-aid", "children's": "childrens-aid",
  // substances
  weed: "drugs", vape: "drugs", vaping: "drugs", smoking: "drugs", alcohol: "drugs",
  drinking: "drugs", drunk: "drugs", pills: "drugs",
  // NB: "high" is deliberately NOT mapped — on a school app "high school" is
  // far more common than the substance sense, and high→drugs made "high
  // school" confidently return the drugs/police answer. Substance queries
  // reach drugs-alcohol via weed/vape/drunk/etc. instead.
  // actions
  snitch: "report", snitching: "report", rat: "report", tattle: "report",
  tell: "report", telling: "report", told: "report", reported: "report", reporting: "report",
  // harm
  cutting: "self-harm", cut: "self-harm", harm: "self-harm",
  hitting: "abuse", hits: "abuse", hit: "abuse", beats: "abuse", beat: "abuse",
  hurting: "abuse", hurts: "abuse", hurt: "abuse", touched: "abuse", touching: "abuse",
  // records
  file: "records", files: "records", notes: "records", osr: "records", record: "records",
  // secrets
  secret: "confidential", secrets: "confidential", private: "confidential",
  confidentiality: "confidential", anonymous: "confidential", anonymously: "confidential",
  // family (step-parents ask the same questions)
  stepdad: "parents", stepmom: "parents", stepfather: "parents", stepmother: "parents",
  // relationships
  boyfriend: "dating", girlfriend: "dating", bf: "dating", gf: "dating", partner: "dating",
  // word families the corpus phrases one way and teens phrase another
  abused: "abuse", abuses: "abuse", abusing: "abuse", abusive: "abuse",
  drink: "drugs", drinks: "drugs",
  hypothetically: "hypothetical",
  yells: "yell", yelling: "yell", screams: "yell", screaming: "yell",
  // noise tokens: SYNONYMS apply BEFORE the stop filter, so mapping a noise
  // word onto an existing stopword deletes it from scoring entirely
  dont: "not", cant: "not", wont: "not", doesnt: "not", didnt: "not", isnt: "not",
  wat: "what", wut: "what", whats: "what", thats: "that",
  u: "you", r: "are", ur: "your", by: "of",
  he: "they", she: "they", his: "their", him: "them", her: "their",
  being: "be", think: "that",
  // identity — "coming" (not "come") maps: "I'm coming out" is unambiguous,
  // bare "come" appears in too many unrelated questions
  gay: "identity", lesbian: "identity", bisexual: "identity", trans: "identity",
  transgender: "identity", lgbt: "identity", lgbtq: "identity", queer: "identity",
  nonbinary: "identity", pronouns: "identity", outed: "identity", coming: "identity",
  // bullying
  bully: "bullying", bullied: "bullying", bullies: "bullying",
  cyberbullying: "bullying", cyberbullied: "bullying",
  // proof / being believed
  evidence: "proof", lying: "proof", liar: "proof",
  // getting started
  started: "start", starting: "start",
  // images
  nudes: "images", pics: "images", photos: "images", sexting: "images",
  // pregnancy/health
  pregnant: "health", pregnancy: "health", std: "health", sti: "health",
  // misc
  jail: "police", arrested: "police", trouble: "consequences",
};

export const CORPUS = [
  {
    id: "what-must-report",
    q: [
      "What do you have to report no matter what?",
      "What does a counsellor have to tell someone else?",
      "Do you have to report if I say someone is hurting me?",
      "What can't stay between us?",
    ],
    // "anyone" is here on purpose: it ties "will you tell anyone" to THIS
    // entry (ties break by CORPUS order — keep this entry above
    // suicide-self-harm, whose q also contains "anyone").
    // "childrens-aid" deliberately NOT a keyword here: bare "cas" queries
    // should land on what-happens-after-report, which explains it.
    keywords: ["report", "abuse", "must", "law", "duty", "anyone"],
    topics: ["reporting"],
    related: ["what-happens-after-report", "what-stays-private"],
    a: [
      "In Ontario, every adult — not just counsellors — must contact a children's aid society if they have reasonable grounds to suspect a child is being abused, neglected, or is at risk of harm. That's the law (the Child, Youth and Family Services Act), and it exists to protect you, not to punish you.",
      "They must make that call themselves — they can't hand it off to someone else. And it applies even if you told them 'in confidence.'",
      "Almost everything else you say stays between you. The must-report list is short: abuse, neglect, serious risk of harm, and immediate danger.",
    ],
    cite: [CITE.oacas, CITE.oct],
  },
  {
    id: "what-stays-private",
    q: [
      "What stays confidential?",
      "What can I say that stays private?",
      "Will everything I say be shared?",
      "There's a lot of yelling at home, is that abuse?",
    ],
    keywords: ["confidential", "private", "stays", "between", "yell"],
    topics: ["confidentiality"],
    related: ["what-must-report", "tell-parents"],
    a: [
      "Most things. Stress, friendship problems, identity questions, grades, anxiety, family arguments that aren't abuse — a counsellor keeps these between you unless you agree otherwise.",
      "The exceptions are about safety: abuse or neglect, serious risk that you'll be hurt or hurt someone else, or a court order. A good counsellor will tell you these limits up front, before you say anything big. You're allowed to ask them to do exactly that.",
    ],
    cite: [CITE.oct, CITE.khp],
  },
  {
    id: "suicide-self-harm",
    q: [
      "What happens if I tell them about self-harm?",
      "If I say I've been cutting will they report it?",
      "Do they tell anyone if I have suicidal thoughts?",
    ],
    keywords: ["self-harm", "suicide", "suicidal", "report"],
    topics: ["confidentiality", "safety"],
    related: ["tell-parents", "what-stays-private"],
    a: [
      "Self-harm and suicidal thoughts aren't automatically reported to children's aid — that duty is about abuse and neglect by others.",
      "But if a counsellor believes you're at serious risk, they will act to keep you safe, which can mean involving your parents or emergency supports. They should talk to you about it first, not go behind your back.",
      "If this is where you are right now: Kids Help Phone (1-800-668-6868, or text CONNECT to 686868) is anonymous and answers 24/7. You can talk it through before deciding anything about school.",
    ],
    cite: [CITE.khp, CITE.oct],
  },
  {
    id: "tell-parents",
    q: [
      "Will the counsellor tell my parents?",
      "Do my parents find out if I talk to a counsellor?",
      "Can they call home about what I said?",
    ],
    keywords: ["parents", "home", "call", "find", "out"],
    topics: ["confidentiality", "parents"],
    related: ["what-stays-private", "records"],
    a: [
      "Not automatically. For most topics, what you say stays between you and them, and if involving your parents would help, they work that out with you — not behind your back.",
      "The exception is safety: if they believe you're at serious risk, they may need to involve your parents or others to protect you. Ask them directly: 'What would make you call my parents?' A good counsellor will answer that plainly before you share anything.",
    ],
    cite: [CITE.oct, CITE.khp],
  },
  {
    id: "age-16-17",
    q: [
      "Does it change when I turn 16?",
      "Do the reporting rules apply to older teens?",
      "I'm 17, do they still have to report?",
    ],
    keywords: ["age", "16", "17", "older", "teen"],
    topics: ["reporting"],
    related: ["what-must-report"],
    a: [
      "Yes, age matters in Ontario. The duty to report is mandatory for children under 16. If you're 16 or 17, professionals are permitted to report concerns about you — but not required to.",
      "In practice that means at 16–17 you have more say: a counsellor can support you and help you plan without an automatic report, except where someone is in immediate danger.",
    ],
    cite: [CITE.oacas],
  },
  {
    id: "what-happens-after-report",
    q: [
      "What happens after they call children's aid?",
      "What does CAS actually do?",
      "If they report it what happens to my family?",
    ],
    keywords: ["childrens-aid", "after", "happens", "report"],
    topics: ["reporting"],
    related: ["what-must-report", "change-mind"],
    a: [
      "A children's aid society first assesses: they talk to people, starting with understanding what's going on. A report does not automatically mean police, and it does not automatically mean you'd be removed from home — most involvement is support for the family, not separation.",
      "The counsellor who made the call doesn't disappear — they can stay your support at school through the whole process.",
      "It's honest to say this is a big step and you can't take it back once it starts. That's exactly why this site shows you the line before you decide what to share.",
    ],
    cite: [CITE.oacas, CITE.ipc],
  },
  {
    id: "friend-disclosure",
    q: [
      "If I tell them about my friend do they report that?",
      "Can I talk about someone else's situation?",
      "My friend is being hurt at home, what happens if I tell?",
    ],
    keywords: ["friend", "someone", "else", "their"],
    topics: ["reporting"],
    related: ["what-must-report"],
    a: [
      "The duty to report covers any child they have grounds to suspect is at risk — including your friend. So yes: if you describe abuse happening to a friend, the counsellor must report that, same as if it were you.",
      "That's not a reason to stay silent — it may be exactly what your friend needs and can't ask for. But you deserve to know it before you speak, so it isn't a surprise.",
    ],
    cite: [CITE.oacas, CITE.oct],
  },
  {
    // sits ABOVE drugs-alcohol on purpose: both bags contain police+call, and
    // exact ties resolve by corpus order — "do they call the cops" must land
    // here, not on a drugs answer
    id: "police",
    q: [
      "Do counsellors call the police?",
      "Will the police get involved if I talk to them?",
    ],
    keywords: ["police", "call", "involved"],
    topics: ["consequences"],
    related: ["drugs-alcohol", "what-must-report"],
    a: [
      "Rarely, and it's a different thing from children's aid. Police come into it when someone is in immediate danger or when the law requires it (for example, certain weapons or violence situations).",
      "Talking about your feelings, your family, your stress, or your mistakes is not a police matter. If you're worried about something specific, ask the counsellor before you share details — 'would this involve police?' is a fair question and they'll answer it.",
    ],
    cite: [CITE.oct],
  },
  {
    id: "drugs-alcohol",
    q: [
      "Will I get in trouble if I tell them about drugs?",
      "If I say I've been drinking do they call the police?",
      "Can I talk about vaping without getting suspended?",
    ],
    keywords: ["drugs", "consequences", "suspended", "police", "illegal"],
    topics: ["consequences"],
    related: ["police", "what-stays-private"],
    a: [
      "Counsellors are not the discipline office, and talking to one about drugs or drinking is not the same as being caught. Their job is support, and substance use on its own isn't something they report to police or children's aid.",
      "It can become a safety issue if it puts you at serious risk — and school rules still exist if something happens on school property. If you're unsure where the line is, ask them first: 'If I talk about this, does it go anywhere?'",
    ],
    cite: [CITE.khp, CITE.oct],
  },
  {
    id: "records",
    q: [
      "Do they write down what I say?",
      "Who can see the counsellor's notes?",
      "Does this go in my school record?",
    ],
    keywords: ["records", "write", "see", "school"],
    topics: ["confidentiality"],
    related: ["tell-parents"],
    a: [
      "Counsellors keep some notes — that's normal and mostly protects you. Their private counselling notes are not the same thing as your official school record (the OSR), and access to them is limited.",
      "Ontario privacy law gives schools rules about what's collected and who sees it. If it matters to you, ask directly: 'What do you write down, and who can read it?' You're entitled to that answer before you share.",
    ],
    cite: [CITE.ipc],
  },
  {
    id: "hypothetical",
    q: [
      "Can I ask what would happen without it counting?",
      "Can I ask a what if question first?",
      "If I ask hypothetically do they have to report?",
    ],
    keywords: ["hypothetical", "what", "if", "asking"],
    topics: ["reporting", "confidentiality"],
    related: ["what-must-report"],
    a: [
      "Mostly yes — asking 'what would you have to do if someone told you X?' is a smart, allowed move, and this site exists to answer exactly those questions.",
      "One honest caveat: the duty to report is triggered by reasonable grounds to suspect, not by magic words. If your 'hypothetical' clearly describes you and clearly describes abuse, a counsellor can't un-hear it. Vague and general is genuinely hypothetical; detailed and personal may not be.",
    ],
    cite: [CITE.oacas],
  },
  {
    id: "teacher-vs-counsellor",
    q: [
      "Is telling a teacher different from telling a counsellor?",
      "Do teachers have the same rules?",
      "Should I tell my teacher or the counsellor?",
    ],
    keywords: ["teacher", "different", "same", "rules"],
    topics: ["reporting"],
    related: ["what-must-report", "adult-is-problem", "counsellor-trust"],
    a: [
      "The reporting rules are the same: every adult who works at your school — teachers, counsellors, coaches, principals — has the same duty to report suspected abuse or neglect.",
      "The difference is the rest: counsellors are trained for these conversations and keep things more separate from your classroom life. But the right adult is the one you trust. A teacher you trust beats a counsellor you don't.",
    ],
    cite: [CITE.oct],
  },
  {
    id: "dating-violence",
    q: [
      "What if my boyfriend or girlfriend is hurting me?",
      "Is dating violence reported?",
    ],
    keywords: ["dating", "abuse", "relationship"],
    topics: ["reporting", "safety"],
    related: ["age-16-17", "what-must-report"],
    a: [
      "If you're under 16 and being hurt by anyone — including someone you're dating — the duty to report applies, and a counsellor must involve children's aid.",
      "At 16 or 17 it shifts: reporting is permitted rather than required, so a counsellor can focus on safety planning with you — helping you decide what happens next rather than deciding for you.",
      "Either way, being hurt by a partner is never something you have to manage alone, and it tends to escalate. This is exactly what counsellors are for.",
    ],
    cite: [CITE.oacas, CITE.khp],
  },
  {
    id: "sexting-images",
    q: [
      "What happens if I tell them someone has my nudes?",
      "Someone is threatening to share my pictures, will I get in trouble?",
    ],
    keywords: ["images", "share", "threatening", "illegal"],
    topics: ["safety", "consequences"],
    related: ["police", "what-must-report"],
    a: [
      "First, the part most people your age don't know: if someone is threatening to share your images, you are the one being wronged — adults treat this as someone harming you, not as you being in trouble.",
      "Because sharing intimate images of anyone under 18 is illegal, adults may need to escalate — which can involve police, aimed at the person doing the sharing. NeedHelpNow.ca and Kids Help Phone can help you get images taken down and plan next steps, anonymously if you want.",
    ],
    cite: [CITE.khp],
  },
  {
    id: "health-confidential",
    q: [
      "Can I ask about pregnancy without my parents knowing?",
      "Are health questions confidential?",
      "Can I ask about birth control?",
    ],
    keywords: ["health", "knowing", "confidential"],
    topics: ["confidentiality"],
    related: ["tell-parents"],
    a: [
      "Health questions — pregnancy, sexual health, your body — are confidential. In Ontario there's no automatic parent notification for asking about your own health, and counsellors can connect you with youth health services that work the same way.",
      "As always, the safety exceptions exist, but 'I have a health question' is not one of them.",
    ],
    cite: [CITE.khp],
  },
  {
    id: "change-mind",
    q: [
      "Can I take it back after I start telling them?",
      "What if I change my mind halfway through?",
      "Can I stop them from reporting once I've said it?",
    ],
    keywords: ["change", "back", "mind", "stop"],
    topics: ["reporting", "confidentiality"],
    related: ["what-happens-after-report", "hypothetical"],
    a: [
      "For most topics, yes — you stay in control. You can pause, ask them to wait, or say 'I'm not ready to do anything about this yet,' and a good counsellor will respect that.",
      "For the must-report things, honestly: no. Once a counsellor has reasonable grounds to suspect abuse, the law requires the call, even if you ask them not to. You can't recall that train — which is exactly why this site helps you see the line before you decide what to say, and lets you ask anything here first, where nothing is recorded.",
    ],
    cite: [CITE.oacas, CITE.oct],
  },
  {
    id: "coming-out",
    q: [
      "If I tell them I'm gay or trans, will they tell my parents?",
      "Is coming out to a counsellor confidential?",
      "Can I talk about my identity without being outed?",
    ],
    keywords: ["identity", "confidential", "parents", "outed"],
    topics: ["confidentiality"],
    related: ["tell-parents", "what-stays-private"],
    a: [
      "Who you are isn't on the must-report list. Being gay, bi, trans, or questioning is not abuse or neglect — so nothing about coming out triggers a report. A good counsellor keeps it between you, and outing you to parents, staff, or students has no place in that conversation.",
      "Since that part rests on the adult, not the law, test it before you say anything: 'If I tell you something about me, who else would ever hear it?' An adult worth telling will answer plainly and let you set the pace.",
      "If home might not be safe if they found out, say that part too — keeping you safe includes keeping your privacy. And Kids Help Phone has counsellors used to exactly this conversation, anonymously, 24/7.",
    ],
    cite: [CITE.khp, CITE.oct],
  },
  {
    id: "taken-away",
    q: [
      "Will I be taken away from my family if I tell?",
      "Does children's aid take kids away?",
      "Will my family get split up if they report?",
    ],
    keywords: ["childrens-aid", "removed", "split", "away", "foster", "care"],
    topics: ["reporting"],
    related: ["what-happens-after-report", "what-must-report"],
    a: [
      "This is the fear that keeps the most people silent, so here's its honest shape: a children's aid society's first move is to understand what's going on and support the family. Most involvement means help brought into your home — not you being taken out of it. Removal is a last resort, for when staying genuinely isn't safe.",
      "Nobody can honestly promise you an outcome, and we won't. What you're allowed to have is the real picture before you decide — that's the difference between telling and being ambushed.",
      "If you want to walk through the specific what-ifs first, anonymously, Kids Help Phone will do exactly that: 1-800-668-6868.",
    ],
    cite: [CITE.oacas, CITE.khp],
  },
  {
    id: "believed-proof",
    q: [
      "What if they don't believe me?",
      "Do I need proof before I tell someone?",
      "What if they think I'm making it up?",
    ],
    keywords: ["proof", "believe", "believed", "believes"],
    topics: ["reporting"],
    related: ["what-must-report", "counsellor-trust"],
    a: [
      "You don't need proof. The legal line in Ontario is 'reasonable grounds to suspect' — your account, in your own words, is enough for an adult to act on. Collecting evidence is the professionals' job, never yours.",
      "School adults are also taught that believing you comes first. It's one of the first things the page this site prepares for your adult tells them: believe them first, verify details later.",
      "And if the first adult reacts badly? That's a fact about them, not about your story. Another adult — or Kids Help Phone — will hear you out. The door doesn't close because one person fumbled it.",
    ],
    cite: [CITE.oacas, CITE.oct],
  },
  {
    id: "adult-is-problem",
    q: [
      "What if the person hurting me works at the school?",
      "Can I report a teacher?",
      "What happens if I tell on a coach or staff member?",
    ],
    keywords: ["teacher", "staff", "report", "abuse"],
    topics: ["reporting", "safety"],
    related: ["what-must-report", "counsellor-trust"],
    a: [
      "The duty to report protects you from everyone — including teachers, coaches, and school staff. Any adult you tell must report suspected abuse no matter who is doing it. 'They work here' changes nothing about that duty.",
      "Pick any adult you trust; it doesn't have to be someone close to that person. And teachers face their own regulator on top of the law — the Ontario College of Teachers can suspend or take away a teacher's licence.",
      "The law specifically protects good-faith reporting — speaking up honestly, even if it turns out you were wrong about something, is not something you get punished for. If saying it inside the building feels impossible, Kids Help Phone can help you plan it from outside.",
    ],
    cite: [CITE.oct, CITE.oacas],
  },
  {
    id: "counsellor-trust",
    q: [
      "What if I don't trust the counsellor?",
      "Do I have to talk to the counsellor specifically?",
      "Can I choose which adult I talk to?",
    ],
    keywords: ["counsellor", "trust", "choose", "different", "problem"],
    topics: ["confidentiality"],
    related: ["teacher-vs-counsellor", "adult-is-problem"],
    a: [
      "You never have to talk to one specific person. The rules are the same for every adult in the building, so the right person is whoever you actually trust — a teacher, a coach, the librarian who remembers your name.",
      "If it's the counsellor's role you want but not that counsellor, you can ask for a different one — and you don't owe anyone a reason.",
      "You can also warm up from a distance: Kids Help Phone is anonymous, and Levels 2 and 3 here exist so the first move doesn't have to be face-to-face.",
    ],
    cite: [CITE.oct, CITE.khp],
  },
  {
    id: "bullying",
    q: [
      "What happens if I tell them I'm being bullied?",
      "Will they actually do something about bullying?",
      "Can I report bullying without making it worse?",
    ],
    keywords: ["bullying", "worse", "retaliation", "online"],
    topics: ["consequences", "safety"],
    related: ["believed-proof", "records"],
    a: [
      "Being bullied isn't a children's-aid matter — but it's also not something school staff can sit on: in Ontario, staff who learn of a serious incident like bullying must bring it to the principal, and principals must investigate and respond, including for things that happen online or off school property.",
      "That duty cuts both ways, so know it going in: telling an adult the details starts something, and schools are also expected to take bullying reports in ways that minimize retaliation. You're allowed to ask 'what exactly happens if I tell you who?' before you say the name.",
      "If you'd rather think it through with someone outside the building first, Kids Help Phone does that anonymously.",
    ],
    cite: [CITE.ont, CITE.khp],
  },
  {
    id: "how-to-start",
    q: [
      "How do I even start talking to a counsellor?",
      "Does seeing the school counsellor cost anything?",
      "Do I need an appointment or a referral?",
      "Can I bring a friend with me?",
      "Can I write it down instead of saying it out loud?",
    ],
    keywords: ["start", "cost", "money", "appointment", "referral", "free", "email", "text", "see", "bring", "talk"],
    topics: ["getting-started"],
    related: ["counsellor-trust", "what-stays-private"],
    a: [
      "It's free — counsellors are part of your school, not a service you pay for. You don't need a referral, a diagnosis, or a 'good enough' reason. 'Can I talk to you sometime?' is a complete opening move.",
      "Every school runs the logistics a little differently — walk-in, a sign-up sheet in the office, or email — but asking any teacher 'how do I see the counsellor?' is a completely ordinary, everyday ask.",
      "And if the walk-up itself is the impossible part: that's literally why this site has Level 2 (write first, under a codename) and Level 3 (hand them a page instead of an opening line).",
    ],
    cite: [CITE.khp],
  },
];
