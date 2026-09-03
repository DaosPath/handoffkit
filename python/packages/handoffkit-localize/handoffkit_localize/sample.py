"""
Public sample game: "The Ballot and the Bridge" (full story chapter)
PG political intrigue for translation demos + HTML story reader.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _msg(*lines: str, face: str = "", face_index: int = 0) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [
        {"code": 101, "indent": 0, "parameters": [face, face_index, 0, 2]}
    ]
    for line in lines:
        out.append({"code": 401, "indent": 0, "parameters": [line]})
    out.append({"code": 0, "indent": 0, "parameters": []})
    return out


def _event(eid: int, name: str, *pages_lists: list[dict[str, Any]]) -> dict[str, Any]:
    pages = [{"list": lst} for lst in pages_lists]
    if not pages:
        pages = [{"list": [{"code": 0, "indent": 0, "parameters": []}]}]
    return {"id": eid, "name": name, "note": "", "pages": pages}


def _map(display: str, events: list[dict[str, Any] | None]) -> dict[str, Any]:
    return {
        "displayName": display,
        "note": "",
        "width": 25,
        "height": 19,
        "scrollType": 0,
        "events": events,
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SYSTEM: dict[str, Any] = {
    "gameTitle": "The Ballot and the Bridge",
    "title1Name": "Title",
    "title2Name": "",
    "currencyUnit": "₡",
    "partyMembers": [1, 2],
    "startMapId": 1,
    "startX": 12,
    "startY": 15,
    "optDisplayTp": True,
    "optDrawTitle": True,
    "hasEncryptedImages": False,
    "hasEncryptedAudio": False,
    "terms": {
        "basic": [
            "Level",
            "Lv",
            "HP",
            "HP",
            "MP",
            "MP",
            "TP",
            "TP",
            "Experience",
            "EXP",
        ],
        "commands": [
            "Investigate",
            "Withdraw",
            "Confront",
            "Guard",
            "Evidence",
            "Skill",
            "Equip",
            "Status",
            "Formation",
            "Save",
            "Game End",
            "Options",
            "Weapon",
            "Armor",
            "Key Item",
            "Equip",
            "Optimize",
            "Clear",
            "New Game",
            "Continue",
            "To Title",
            "Cancel",
            "Buy",
            "Sell",
        ],
        "params": [
            "Max HP",
            "Max MP",
            "Attack",
            "Defense",
            "M.Attack",
            "M.Defense",
            "Agility",
            "Luck",
            "Hit",
            "Evasion",
        ],
        "messages": {
            "alwaysDash": "Always Dash",
            "commandRemember": "Command Remember",
            "bgmVolume": "BGM Volume",
            "bgsVolume": "BGS Volume",
            "meVolume": "ME Volume",
            "seVolume": "SE Volume",
            "possession": "In possession",
            "expTotal": "Current Exp",
            "expNext": "To Next %1",
            "saveMessage": "Which file would you like to save to?",
            "loadMessage": "Which file would you like to load?",
            "file": "File",
            "partyName": "%1's Team",
            "emerge": "%1 appeared!",
            "preemptive": "%1 seized the initiative!",
            "surprise": "%1 was caught off guard!",
            "escapeStart": "%1 tries to withdraw!",
            "escapeFailure": "There was no clean exit!",
            "victory": "%1 held the line!",
            "defeat": "%1 was forced to retreat.",
            "obtainExp": "%1 EXP gained!",
            "obtainGold": "Found %1\\G!",
            "obtainItem": "Obtained %1!",
            "levelUp": "%1 reached rank %2!",
            "obtainSkill": "Learned %1!",
            "useItem": "%1 uses %2!",
            "criticalToEnemy": "Decisive strike!",
            "criticalToActor": "A crushing blow!",
            "actorDamage": "%1 took %2 damage!",
            "actorRecovery": "%1 recovered %2 %3!",
            "actorGain": "%1 gained %2 %3!",
            "actorLoss": "%1 lost %2 %3!",
            "actorDrain": "%1 lost %2 %3 to drain!",
            "actorNoDamage": "%1 took no damage!",
            "actorNoHit": "Miss! %1 took no damage!",
            "enemyDamage": "%1 took %2 damage!",
            "enemyRecovery": "%1 recovered %2 %3!",
            "enemyGain": "%1 gained %2 %3!",
            "enemyLoss": "%1 lost %2 %3!",
            "enemyDrain": "%1 lost %2 %3 to drain!",
            "enemyNoDamage": "%1 took no damage!",
            "enemyNoHit": "Miss! %1 took no damage!",
            "evasion": "%1 dodged!",
            "magicEvasion": "%1 resisted the effect!",
            "magicReflection": "%1 reflected the effect!",
            "counterAttack": "%1 counterattacked!",
            "substitute": "%1 shielded %2!",
            "buffAdd": "%1's %2 rose!",
            "debuffAdd": "%1's %2 fell!",
            "buffRemove": "%1's %2 returned to normal!",
            "actionFailure": "No effect on %1!",
        },
    },
    "switches": [
        "",
        "Election Day",
        "Bridge Protest",
        "Evidence Found",
        "Debate Open",
        "Warehouse Opened",
        "Story Published",
        "Audit Motion",
        "Silent March",
        "Final Count",
    ],
    "variables": [
        "",
        "Public Trust",
        "Press Freedom",
        "Budget Overrun",
        "Votes Counted",
        "Donor Pressure",
        "Union Support",
    ],
    "elements": ["", "Physical", "Rhetoric", "Law", "Network", "Reputation"],
    "skillTypes": ["", "Fieldwork", "Oratory", "Analysis"],
    "weaponTypes": ["", "Pen", "Camera", "Recorder"],
    "armorTypes": ["", "Coat", "Badge", "Vest"],
    "equipTypes": ["", "Weapon", "Shield", "Head", "Body", "Accessory"],
}

ACTORS = [
    None,
    {
        "id": 1,
        "name": "Mira Solan",
        "nickname": "The Inkblade",
        "profile": "Investigative reporter for the Marenth Free Ledger. Believes sunlight is the best disinfectant.",
        "note": "",
        "characterName": "Actor1",
        "faceName": "Actor1",
        "battlerName": "Actor1_1",
        "characterIndex": 0,
        "faceIndex": 0,
    },
    {
        "id": 2,
        "name": "Nia Voss",
        "nickname": "Reform Whip",
        "profile": "Opposition deputy. Wants a clean election and a bridge that serves people, not donors.",
        "note": "",
        "characterName": "Actor2",
        "faceName": "Actor2",
        "battlerName": "Actor2_1",
        "characterIndex": 0,
        "faceIndex": 0,
    },
    {
        "id": 3,
        "name": "Tor Hale",
        "nickname": "Dock Voice",
        "profile": "Harbor union leader. Counts every delayed wage like a broken promise.",
        "note": "",
        "characterName": "Actor3",
        "faceName": "Actor3",
        "battlerName": "Actor3_1",
        "characterIndex": 0,
        "faceIndex": 0,
    },
    {
        "id": 4,
        "name": "Petra Quinn",
        "nickname": "Editor-in-Chief",
        "profile": "Runs the Free Ledger with ink-stained hands and a lawyer on speed dial.",
        "note": "",
        "characterName": "Actor1",
        "faceName": "Actor1",
        "battlerName": "Actor1_2",
        "characterIndex": 1,
        "faceIndex": 1,
    },
]

CLASSES = [
    None,
    {"id": 1, "name": "Journalist", "note": "", "learnings": []},
    {"id": 2, "name": "Legislator", "note": "", "learnings": []},
    {"id": 3, "name": "Organizer", "note": "", "learnings": []},
    {"id": 4, "name": "Editor", "note": "", "learnings": []},
]

SKILLS = [
    None,
    {
        "id": 1,
        "name": "Open Records Request",
        "description": "Forces a bureaucratic door. May lower secrecy.",
        "message1": "%1 files an open records request!",
        "message2": "",
        "note": "",
    },
    {
        "id": 2,
        "name": "Town Hall Question",
        "description": "Ask the question no one wanted on camera.",
        "message1": "%1 asks a hard question!",
        "message2": "",
        "note": "",
    },
    {
        "id": 3,
        "name": "Fact Check",
        "description": "Compare claims against primary sources.",
        "message1": "%1 fact-checks the claim!",
        "message2": "",
        "note": "",
    },
    {
        "id": 4,
        "name": "Coalition Pitch",
        "description": "Unite unlikely allies around one shared interest.",
        "message1": "%1 builds a coalition!",
        "message2": "",
        "note": "",
    },
    {
        "id": 5,
        "name": "Live Broadcast",
        "description": "Put the story on air before spin can harden.",
        "message1": "%1 goes live!",
        "message2": "",
        "note": "",
    },
    {
        "id": 6,
        "name": "Subpoena Trail",
        "description": "Follow the paper until the signature has nowhere to hide.",
        "message1": "%1 follows the subpoena trail!",
        "message2": "",
        "note": "",
    },
]

ITEMS = [
    None,
    {
        "id": 1,
        "name": "Press Pass",
        "description": "Allows entry to Parliament galleries and official briefings.",
        "note": "",
    },
    {
        "id": 2,
        "name": "Sealed Ledger",
        "description": "A budget book with pages marked in red ink. Someone tried to hide the bridge overruns.",
        "note": "",
    },
    {
        "id": 3,
        "name": "Ballot Box Photo",
        "description": "Timestamped photo of unopened boxes behind a warehouse.",
        "note": "",
    },
    {
        "id": 4,
        "name": "Morning Free Ledger",
        "description": "Headline: TRUST ON THE LINE AS ELECTION DAY NEARS.",
        "note": "",
    },
    {
        "id": 5,
        "name": "Bridge Petition",
        "description": "Twelve thousand signatures from the Bridge District.",
        "note": "",
    },
    {
        "id": 6,
        "name": "USB Drive — Contracts",
        "description": "Scanned contracts linking Continuity Fund to Harbor Logistics Ltd.",
        "note": "",
    },
    {
        "id": 7,
        "name": "Court Filing",
        "description": "Emergency motion for observers in every counting room.",
        "note": "",
    },
    {
        "id": 8,
        "name": "Voice Memo",
        "description": "A whispered tip: Pier Nine after midnight. No logo on the vans.",
        "note": "",
    },
]

WEAPONS = [
    None,
    {
        "id": 1,
        "name": "Fountain Pen",
        "description": "An old pen that has signed more truth than treaties.",
        "note": "",
    },
    {
        "id": 2,
        "name": "Pocket Camera",
        "description": "Small enough to smuggle into a closed hearing.",
        "note": "",
    },
    {
        "id": 3,
        "name": "Digital Recorder",
        "description": "Captures the words people later claim they never said.",
        "note": "",
    },
]

ARMORS = [
    None,
    {
        "id": 1,
        "name": "Press Vest",
        "description": "Not armor against bullets—armor against being ignored.",
        "note": "",
    },
    {
        "id": 2,
        "name": "Union Pin",
        "description": "A simple pin. Heavy with meaning on the docks.",
        "note": "",
    },
    {
        "id": 3,
        "name": "Parliament Badge",
        "description": "Gallery access. Does not grant honesty.",
        "note": "",
    },
]

ENEMIES = [
    None,
    {"id": 1, "name": "Spin Doctor", "note": "", "battlerName": ""},
    {"id": 2, "name": "Security Detail", "note": "", "battlerName": ""},
    {"id": 3, "name": "Rumor Network", "note": "", "battlerName": ""},
    {"id": 4, "name": "Lobbyist", "note": "", "battlerName": ""},
    {"id": 5, "name": "Troll Farm Bot", "note": "", "battlerName": ""},
]

STATES = [
    None,
    {
        "id": 1,
        "name": "Under Scrutiny",
        "message1": "%1 is under public scrutiny!",
        "message2": "%1 remains under scrutiny.",
        "message3": "",
        "message4": "%1 is no longer under scrutiny.",
        "note": "",
    },
    {
        "id": 2,
        "name": "Censored",
        "message1": "%1 was censored!",
        "message2": "%1 is still censored.",
        "message3": "",
        "message4": "%1 can speak freely again.",
        "note": "",
    },
    {
        "id": 3,
        "name": "Viral",
        "message1": "%1's story went viral!",
        "message2": "%1 is still trending.",
        "message3": "",
        "message4": "%1 left the timeline.",
        "note": "",
    },
]

# ---------------------------------------------------------------------------
# Maps 1–12 — full chapter
# ---------------------------------------------------------------------------

MAP001 = _map(
    "Capital Plaza — Morning",
    [
        None,
        _event(
            1,
            "Prologue",
            _msg(
                "Narrator: The Republic of Marenth votes in three days.",
                "Narrator: Campaign banners cover the plaza like borrowed hope.",
                "Narrator: You are Mira Solan of the Free Ledger.",
                "Narrator: Your editor wants a story. The city wants a miracle.",
                "Narrator: Between them stands a bridge, a budget, and a lie with excellent lighting.",
            ),
        ),
        _event(
            2,
            "Street Vendor",
            _msg(
                "Vendor: Buttons for every party! Blue order, green reform, red labor!",
                "Vendor: Don't look at me like that. Buttons don't vote—people do.",
                "Mira: Keep the change. Keep the receipt too.",
                "Vendor: Receipts are for people who trust paper. Smart.",
            ),
        ),
        _event(
            3,
            "Activist Kim",
            _msg(
                "Kim: If the bridge goes up without housing, Bridge District becomes a postcard.",
                "Kim: Pretty lights. Empty kitchens.",
                "Mira: Who signed the emergency zoning?",
                "Kim: Ask Parliament. Or ask the donors who never stand in floodwater.",
                "Kim: We march at dusk. Silent. Bring a camera that doesn't blink.",
            ),
        ),
        _event(
            4,
            "Poster Wall",
            _msg(
                "Poster: HARLAN 2026 — STABILITY IS FREEDOM.",
                "Poster: Small print: Paid for by Citizens for Continuity.",
                "Poster: VOSS — AUDIT THE BRIDGE. COUNT EVERY VOTE.",
                "Mira: Continuity of what, exactly?",
            ),
        ),
        _event(
            5,
            "Tourist",
            _msg(
                "Tourist: Is this the famous Freedom Plaza?",
                "Mira: Today it is Campaign Plaza. Freedom is on break.",
                "Tourist: ...Should I still take a photo?",
                "Mira: Take two. One for memory. One for evidence.",
            ),
        ),
        _event(
            6,
            "Directions",
            _msg(
                "Sign: North — Parliament Hall. East — Free Ledger Newsroom.",
                "Sign: South — Bridge District. West — Harbor Docks.",
                "Sign: Northeast — Campaign HQ. Northwest — Courthouse.",
                "Mira: Start with the building that never answers the first question.",
            ),
        ),
        _event(
            7,
            "Student",
            _msg(
                "Student: My professor said democracy is a verb.",
                "Student: Feels more like a group project where half the class is missing.",
                "Mira: Then show up. Bring notes. Ask who graded the rubric.",
            ),
        ),
    ],
)

MAP002 = _map(
    "Parliament Hall",
    [
        None,
        _event(
            1,
            "Guard",
            _msg(
                "Guard: Gallery seats require a press pass and a smile.",
                "Mira: I brought the pass. The smile is optional.",
                "Guard: ...Go on. Don't trip the microphones.",
                "Guard: And if you film the annex doors, you never heard that from me.",
            ),
        ),
        _event(
            2,
            "Nia Voss",
            _msg(
                "Nia: They call the bridge a gift. Gifts don't seize riverside leases.",
                "Nia: The Reform Bloc will demand a public audit before the vote.",
                "Mira: Will Harlan allow it?",
                "Nia: He will praise transparency, then bury it in committee.",
                "Nia: Unless you put numbers on the front page first.",
                "Nia: Two swing deputies still answer their phones. For now.",
            ),
        ),
        _event(
            3,
            "Clerk",
            _msg(
                "Clerk: Budget annex B is restricted until after election day.",
                "Mira: After the people can no longer change course.",
                "Clerk: I don't write the calendar. I only stamp it.",
                "Clerk: ...If you lost a folder near the side door, I didn't see it.",
                "Clerk: Red tabs. Coffee stain shaped like a comma.",
            ),
        ),
        _event(
            4,
            "Floor Debate",
            _msg(
                "Speaker: Order! The chair recognizes the Minister of Works.",
                "Minister: Delay is sabotage. The bridge creates jobs.",
                "Nia: Jobs for whom? Contracts for whom?",
                "Minister: For Marenth! For growth!",
                "Nia: Growth that floods schools is not growth. It is theft with scaffolding.",
                "Crowd: (murmurs rise like weather)",
            ),
        ),
        _event(
            5,
            "Harlan Appears",
            _msg(
                "President Harlan: Democracy thrives on calm markets and calm streets.",
                "President Harlan: Panic is a luxury for people who never govern.",
                "Mira: Panic is also a luxury for people who never listen.",
                "President Harlan: Quote me carefully, Miss Solan. Ink lasts longer than applause.",
                "President Harlan: The nation will cross the river. History prefers builders.",
            ),
        ),
        _event(
            6,
            "Opposition Aide",
            _msg(
                "Aide: The audit motion is scheduled for tomorrow morning.",
                "Aide: Continuity is whipping votes in the corridors, not on the floor.",
                "Aide: Watch who leaves early for 'constituent dinners.'",
            ),
        ),
    ],
)

MAP003 = _map(
    "Free Ledger Newsroom",
    [
        None,
        _event(
            1,
            "Editor Petra",
            _msg(
                "Petra: If you write feelings, we print poetry. If you write proof, we print power.",
                "Petra: Bring me the sealed ledger or the ballot photo—preferably both.",
                "Petra: And Mira? Leave your courage outside the libel lawyer's office.",
                "Petra: Keep it in the story where it belongs.",
            ),
        ),
        _event(
            2,
            "Intern Jay",
            _msg(
                "Intern: Social feeds say the opposition staged the warehouse boxes.",
                "Intern: Also that you work for foreign capital. Also that you don't exist.",
                "Mira: Pick one rumor. Then find a primary source that kills it.",
                "Intern: Already started a spreadsheet. Columns for lie, source, and motive.",
            ),
        ),
        _event(
            3,
            "Archive Terminal",
            _msg(
                "Archive: Previous election: turnout 71%. Disputed precincts: three.",
                "Archive: Bridge Phase One budget: doubled in eighteen months.",
                "Archive: Keyword match: Continuity Fund ↔ Harbor Logistics Ltd.",
                "Archive: Board member overlap: two. Shared address: one.",
            ),
        ),
        _event(
            4,
            "Morning Edition",
            _msg(
                "Headline: TRUST ON THE LINE AS ELECTION DAY NEARS",
                "Subhead: Journalists barred from annex rooms; unions plan silent march.",
                "Petra: Run it above the fold. Leave space for tomorrow's explosion.",
            ),
        ),
        _event(
            5,
            "Lawyer Call",
            _msg(
                "Lawyer: If you publish the contracts, attribute every scan.",
                "Lawyer: If a source is anonymous, say why safety requires it.",
                "Lawyer: Truth is a defense. Sloppiness is a donation to them.",
            ),
        ),
        _event(
            6,
            "Night Desk",
            _msg(
                "Copy Editor: Your lede is sharp. Your third paragraph still assumes guilt.",
                "Copy Editor: Let the documents accuse. You narrate the path.",
                "Mira: Path rewritten. Accusations footnoted.",
            ),
        ),
    ],
)

MAP004 = _map(
    "Bridge District",
    [
        None,
        _event(
            1,
            "Resident Amal",
            _msg(
                "Amal: They measured my door twice. Never measured my years here.",
                "Amal: Relocation voucher equals half a room across the river.",
                "Amal: Tell Parliament that families are not a rounding error.",
                "Amal: My daughter asks if the bridge will have a school on it.",
            ),
        ),
        _event(
            2,
            "Site Fence",
            _msg(
                "Sign: FUTURE GATEWAY PROJECT — KEEP OUT",
                "Graffiti: WHOSE FUTURE?",
                "Graffiti: COUNT US BEFORE YOU CROSS US",
                "Mira: A fence is a sentence with no subject.",
            ),
        ),
        _event(
            3,
            "Teacher Lina",
            _msg(
                "Lina: The school loses its yard if the access road expands.",
                "Lina: Children learn civics while watching bulldozers practice it.",
                "Mira: Will teachers speak at the town hall?",
                "Lina: We will—if cameras protect us more than slogans do.",
            ),
        ),
        _event(
            4,
            "Petition Table",
            _msg(
                "Volunteer: Twelve thousand names. Each one a person who stays late after work.",
                "Volunteer: Signatures don't block cement. Stories might.",
                "Mira: Then we print both: the count and the faces.",
            ),
        ),
        _event(
            5,
            "Night Watch Tip",
            _msg(
                "Stranger: Warehouse on Pier Nine. Lights after midnight. No logo.",
                "Stranger: I like my job. I like sleeping more.",
                "Mira: You were never here. I was never told.",
                "Stranger: Good. History hates named tips.",
            ),
        ),
        _event(
            6,
            "Shopkeeper",
            _msg(
                "Shopkeeper: Flood insurance rose after the plans leaked.",
                "Shopkeeper: Funny how risk prices arrive before justice.",
                "Mira: Keep your invoices. Numbers are quieter than speeches—and louder.",
            ),
        ),
    ],
)

MAP005 = _map(
    "Harbor Docks",
    [
        None,
        _event(
            1,
            "Tor Hale",
            _msg(
                "Tor: Cargo moves. Wages stall. Speeches arrive on time.",
                "Tor: Labor doesn't hate bridges. Labor hates being the toll.",
                "Tor: If your paper wants quotes, print the overtime sheets too.",
                "Tor: Silent march tomorrow. Empty hands. Full phones.",
            ),
        ),
        _event(
            2,
            "Docker Rae",
            _msg(
                "Docker: They said the new port clause protects security.",
                "Docker: Funny how security always needs cheaper hands.",
                "Mira: Who negotiates for you when cameras leave?",
                "Docker: Tor. And coffee. Mostly Tor.",
            ),
        ),
        _event(
            3,
            "Warehouse Pier Nine",
            _msg(
                "Mira: The lock is new. The dust is old.",
                "Mira: Ballot seals. Unopened. Wrong precinct stamps.",
                "Mira: Click. Flash. Timestamp. Now it's evidence—or a target.",
                "Mira: Second photo of the van plate. Third of the security cam angle.",
            ),
        ),
        _event(
            4,
            "Radio on the Pier",
            _msg(
                "Radio: Officials deny irregularities and urge citizens to reject chaos.",
                "Radio: Opposition demands observers in every counting room.",
                "Radio: Markets open flat. Rain expected by evening.",
                "Radio: President Harlan to address the nation at nine.",
            ),
        ),
        _event(
            5,
            "Harbor Cat",
            _msg(
                "Narrator: A cat walks the crate line like it owns the port authority.",
                "Mira: Even the strays know which doors open after dark.",
            ),
        ),
    ],
)

MAP006 = _map(
    "Campaign HQ — Continuity",
    [
        None,
        _event(
            1,
            "Volunteer Blue",
            _msg(
                "Volunteer: Welcome! Would you like a pamphlet on stability?",
                "Mira: I'd like the annex budget, actually.",
                "Volunteer: That's... not in the welcome kit.",
                "Mira: Then your kit is missing the plot.",
            ),
        ),
        _event(
            2,
            "Campaign Manager",
            _msg(
                "Manager: The press is addicted to crisis. We sell continuity.",
                "Manager: People vote for the bridge they can picture, not the audit they can't.",
                "Mira: People also vote after they see who bills them for the picture.",
                "Manager: On the record: no comment. Off the record: still no comment.",
            ),
        ),
        _event(
            3,
            "Donor Lounge",
            _msg(
                "Donor: Infrastructure is patriotism with a return.",
                "Donor: You reporters think every profit is a scandal.",
                "Mira: I think every secret invoice is a question.",
                "Donor: Questions don't pour concrete.",
                "Mira: Neither do lies—forever.",
            ),
        ),
        _event(
            4,
            "Strategy Board",
            _msg(
                "Board: MESSAGE PILLARS — ORDER / JOBS / PRIDE",
                "Board: AVOID — OVERAGE, RELOCATION, BOXES",
                "Mira: Avoid is a confession wearing a sticky note.",
            ),
        ),
    ],
)

MAP007 = _map(
    "Reform Campaign Office",
    [
        None,
        _event(
            1,
            "Nia Strategy",
            _msg(
                "Nia: We cannot outspend Continuity. We can out-document them.",
                "Nia: Your warehouse photos buy us twenty-four hours of oxygen.",
                "Nia: After that, they will call it deepfake weather.",
                "Mira: Then we publish chain of custody with the images.",
            ),
        ),
        _event(
            2,
            "Data Volunteer",
            _msg(
                "Volunteer: Precinct map overlay shows warehouse zip matching delayed tallies.",
                "Volunteer: Correlation is not proof. It is a flashlight.",
                "Mira: Aim it. I'll bring the witnesses.",
            ),
        ),
        _event(
            3,
            "Phone Bank",
            _msg(
                "Caller: Hello, this is Reform Bloc reminding you observers are legal.",
                "Caller: Bring water. Bring patience. Bring a friend who can count.",
                "Mira: Democracy's least glamorous engine: lists and sore feet.",
            ),
        ),
    ],
)

MAP008 = _map(
    "Courthouse Steps",
    [
        None,
        _event(
            1,
            "Filing",
            _msg(
                "Clerk of Court: Emergency motion received. Hearing at four.",
                "Clerk of Court: Gallery limited. Cameras at the judge's discretion.",
                "Mira: We'll take the seats and the transcript either way.",
            ),
        ),
        _event(
            2,
            "Civic Lawyer",
            _msg(
                "Lawyer: We ask for observers, sealed chain logs, and delayed certification.",
                "Lawyer: They will call it chaos. We call it due process on a deadline.",
                "Mira: How do you want the public to hear it?",
                "Lawyer: Simply: count what was cast, not what was convenient.",
            ),
        ),
        _event(
            3,
            "Protester",
            _msg(
                "Protester: I don't love either party. I love a fair tally.",
                "Protester: If that makes me radical, the dictionary is broken.",
            ),
        ),
        _event(
            4,
            "Ruling Snippet",
            _msg(
                "Judge: Temporary observers permitted in three disputed precincts.",
                "Judge: Warehouse materials to be inventoried under dual keys.",
                "Judge: The election continues. The law does not nap for convenience.",
                "Mira: Not victory. Oxygen. We'll take it.",
            ),
        ),
    ],
)

MAP009 = _map(
    "TV Studio Channel 7",
    [
        None,
        _event(
            1,
            "Host Prep",
            _msg(
                "Host: Ninety seconds. No jargon without translation.",
                "Host: Viewers are tired. Tired people still deserve facts.",
                "Mira: Lead with the photos, then the budget trail, then the court order.",
            ),
        ),
        _event(
            2,
            "Live Segment",
            _msg(
                "Host: Joining us is Mira Solan of the Free Ledger.",
                "Mira: We verified unopened ballot containers at Pier Nine.",
                "Mira: Precinct stamps do not match the storage claim.",
                "Mira: Bridge contracts show overruns tied to Continuity Fund partners.",
                "Host: Officials say you endanger stability.",
                "Mira: Stability that fears counting is not stability. It is stagecraft.",
            ),
        ),
        _event(
            3,
            "Afterglow",
            _msg(
                "Producer: Clip is already mirrored on three platforms.",
                "Producer: Also a deepfake already claims you recanted.",
                "Mira: Publish the raw file hash. Let the fake chase the original.",
            ),
        ),
    ],
)

MAP010 = _map(
    "Rural Precinct 14",
    [
        None,
        _event(
            1,
            "Poll Worker",
            _msg(
                "Worker: We open at seven. We close when the last person in line votes.",
                "Worker: That used to be normal. Now it's treated like a plot.",
                "Mira: Normal is a political achievement. Thank you for keeping it.",
            ),
        ),
        _event(
            2,
            "Elder Voter",
            _msg(
                "Elder: I voted when the bridge was only a rumor.",
                "Elder: I will vote when it is steel. Rumors don't cancel my name.",
                "Elder: Print the names of anyone who tries.",
            ),
        ),
        _event(
            3,
            "Observer",
            _msg(
                "Observer: Court badge. Dual keys. No one moves a box alone.",
                "Observer: Boring procedure is the romance of a fair count.",
            ),
        ),
        _event(
            4,
            "Young Couple",
            _msg(
                "Partner A: We registered after the housing notices.",
                "Partner B: If they move us, they still can't move our ballots backward.",
                "Mira: That's the cleanest political theory I've heard all week.",
            ),
        ),
    ],
)

MAP011 = _map(
    "Election Night HQ",
    [
        None,
        _event(
            1,
            "Petra Live Desk",
            _msg(
                "Petra: We publish the warehouse photos in ten minutes.",
                "Petra: Legal signed. I didn't ask if they slept.",
                "Petra: Mira, if the city burns, we still spell names correctly.",
                "Petra: And we correct ourselves faster than they smear us.",
            ),
        ),
        _event(
            2,
            "Nia Call",
            _msg(
                "Nia: The audit motion failed by two votes. Two.",
                "Nia: Someone crossed the floor after closed doors.",
                "Nia: Keep reporting. Laws lag behind light.",
                "Nia: The court order still stands. Use it like a shield, not a trophy.",
            ),
        ),
        _event(
            3,
            "Tor March Update",
            _msg(
                "Tor: We march silent so they can't call it a riot.",
                "Tor: Hands empty. Phones up. Eyes open.",
                "Tor: If anyone throws a bottle, they are not with us.",
                "Crowd: (silence like a held breath across the avenue)",
            ),
        ),
        _event(
            4,
            "Harlan Address",
            _msg(
                "President Harlan: Institutions held. Rumors did not.",
                "President Harlan: A bridge will rise. Order will hold. History will thank patience.",
                "President Harlan: Those who chase boxes instead of ballots chase chaos.",
                "Mira: History also thanks footnotes.",
            ),
        ),
        _event(
            5,
            "Count Room Feed",
            _msg(
                "Feed: Precinct 14 recanvass underway under dual observation.",
                "Feed: Pier Nine inventory logged: 40 containers, mixed seals.",
                "Feed: No certification until inventory closes.",
                "Intern: Refresh. Refresh. Democracy as a loading bar.",
            ),
        ),
    ],
)

MAP012 = _map(
    "Dawn After — Epilogue",
    [
        None,
        _event(
            1,
            "Plaza Dawn",
            _msg(
                "Narrator: Morning does not solve a republic. It only reveals what night tried to hide.",
                "Narrator: Some precincts reopen boxes under watch. Some never will.",
                "Narrator: The bridge plans are frozen pending audit—temporary, contested, real.",
            ),
        ),
        _event(
            2,
            "Mira to Self",
            _msg(
                "Mira: We did not elect a saint. We forced a brighter room.",
                "Mira: That is not cynicism. That is maintenance.",
            ),
        ),
        _event(
            3,
            "Allies",
            _msg(
                "Nia: Two votes still haunt me. But light has a longer memory than corridors.",
                "Tor: Wages still lag. The march was a beginning, not a paycheck.",
                "Petra: Page one is clear. Page two is the fight they hope you abandon.",
            ),
        ),
        _event(
            4,
            "Kim and Amal",
            _msg(
                "Kim: Housing language is in the interim order. We'll hold them to every word.",
                "Amal: My door was measured again—this time with a lawyer present.",
                "Amal: Small difference. Everything.",
            ),
        ),
        _event(
            5,
            "Final Narration",
            _msg(
                "Narrator: Mira Solan does not win an election. She widens the room where truth can stand.",
                "Narrator: In Marenth, that is not the end of politics—",
                "Narrator: —it is the minimum condition for it.",
                "Narrator: The ballots will be counted. The bridge will be questioned.",
                "Narrator: And the Free Ledger will keep a light on both.",
                "Narrator: THE BALLOT AND THE BRIDGE",
                "Narrator: — END —",
                "System: Thanks for playing the localization demo chapter.",
                "System: Switch language packs to compare translations side by side.",
            ),
        ),
    ],
)

MAP_INFOS = [
    None,
    {"id": 1, "name": "Capital Plaza — Morning", "parentId": 0, "expanded": True},
    {"id": 2, "name": "Parliament Hall", "parentId": 0, "expanded": False},
    {"id": 3, "name": "Free Ledger Newsroom", "parentId": 0, "expanded": False},
    {"id": 4, "name": "Bridge District", "parentId": 0, "expanded": False},
    {"id": 5, "name": "Harbor Docks", "parentId": 0, "expanded": False},
    {"id": 6, "name": "Campaign HQ — Continuity", "parentId": 0, "expanded": False},
    {"id": 7, "name": "Reform Campaign Office", "parentId": 0, "expanded": False},
    {"id": 8, "name": "Courthouse Steps", "parentId": 0, "expanded": False},
    {"id": 9, "name": "TV Studio Channel 7", "parentId": 0, "expanded": False},
    {"id": 10, "name": "Rural Precinct 14", "parentId": 0, "expanded": False},
    {"id": 11, "name": "Election Night HQ", "parentId": 0, "expanded": False},
    {"id": 12, "name": "Dawn After — Epilogue", "parentId": 0, "expanded": False},
]

COMMON_EVENTS = [
    None,
    {
        "id": 1,
        "name": "Tutorial: How to Demo Translation",
        "list": _msg(
            "System: This sample is built for localization demos.",
            "System: Extract strings, translate packs, then switch language.",
            "System: Political terms stress tone, formality, and consistency.",
            "System: Play with: hk-localize play  (not file://)",
        ),
        "switchId": 1,
        "trigger": 0,
    },
    {
        "id": 2,
        "name": "Glossary Seeds",
        "list": _msg(
            "Glossary: Republic of Marenth",
            "Glossary: Free Ledger",
            "Glossary: Bridge District",
            "Glossary: Reform Bloc",
            "Glossary: Citizens for Continuity",
            "Glossary: Continuity Fund",
            "Glossary: Harbor Logistics Ltd.",
            "Glossary: President Harlan",
            "Glossary: Mira Solan",
            "Glossary: Nia Voss",
            "Glossary: Tor Hale",
            "Glossary: Petra Quinn",
            "Glossary: Pier Nine",
            "Glossary: Precinct 14",
        ),
        "switchId": 1,
        "trigger": 0,
    },
    {
        "id": 3,
        "name": "Theme Reminder",
        "list": _msg(
            "Theme: Who pays for the bridge, and who is asked to move?",
            "Theme: Counting ballots is not chaos; hiding them is.",
            "Theme: Journalism is maintenance of the public room.",
        ),
        "switchId": 1,
        "trigger": 0,
    },
]


def _play_html(map_files: list[str]) -> str:
    maps_js = json.dumps(map_files)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The Ballot and the Bridge — Demo Reader</title>
<style>
  :root {{
    --bg: #0c1222;
    --panel: #141c2e;
    --ink: #e8eefc;
    --muted: #93a4c3;
    --accent: #5b9dff;
    --line: #243047;
    --good: #3dd68c;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(1200px 600px at 10% -10%, #1a2744, var(--bg));
    color: var(--ink);
  }}
  header {{
    display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
    justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--line);
    background: rgba(10,14,24,.9); backdrop-filter: blur(8px);
    position: sticky; top: 0; z-index: 10;
  }}
  h1 {{ font-size: 1.05rem; margin: 0; letter-spacing: .02em; }}
  h1 span {{ color: var(--muted); font-weight: 500; font-size: .85rem; }}
  .controls {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }}
  select, button {{
    background: var(--panel); color: var(--ink);
    border: 1px solid var(--line); border-radius: 10px;
    padding: 8px 12px; font: inherit; cursor: pointer;
  }}
  button.primary {{ background: var(--accent); color: #061018; border-color: transparent; font-weight: 600; }}
  button:disabled {{ opacity: .45; cursor: not-allowed; }}
  main {{ max-width: 860px; margin: 0 auto; padding: 24px 16px 80px; }}
  .scene {{
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 16px; padding: 22px; min-height: 300px;
    box-shadow: 0 20px 50px rgba(0,0,0,.25);
  }}
  .loc {{ color: var(--accent); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }}
  .line {{ font-size: 1.22rem; line-height: 1.55; white-space: pre-wrap; min-height: 4.8em; }}
  .meta {{ margin-top: 18px; color: var(--muted); font-size: .9rem; display:flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }}
  .progress {{ height: 6px; background: #0a101c; border-radius: 99px; overflow: hidden; margin-top: 16px; }}
  .progress > i {{ display:block; height:100%; background: linear-gradient(90deg,#3b82f6,#22d3ee); width: 0%; }}
  footer {{ text-align: center; color: var(--muted); font-size: .8rem; padding: 12px; }}
  .tag {{ color: var(--good); }}
  .err {{ color: #fb7185; }}
  .hint {{ margin-top: 10px; font-size: .85rem; color: var(--muted); }}
</style>
</head>
<body>
<header>
  <h1>The Ballot and the Bridge <span>· full chapter · localization demo</span></h1>
  <div class="controls">
    <label>Lang
      <select id="lang"><option value="en">English</option></select>
    </label>
    <button id="reload" type="button">Load pack</button>
    <button id="prev" type="button">Back</button>
    <button id="next" class="primary" type="button">Next</button>
  </div>
</header>
<main>
  <div class="scene">
    <div class="loc" id="loc">—</div>
    <div class="line" id="line">Loading…</div>
    <div class="progress"><i id="bar"></i></div>
    <div class="meta">
      <span id="idx">0 / 0</span>
      <span id="status" class="tag">PG political chapter</span>
    </div>
    <div class="hint">Tip: arrow keys / space to advance. Use hk-localize play (not file://).</div>
  </div>
</main>
<footer>handoffkit-localize public sample — story reader, not full RPG Maker runtime.</footer>
<script>
const MAPS = {maps_js};
let script = [];
let i = 0;
const LANG_LABELS = {{ en:"English", es:"Español", zh:"中文", pt:"Português", hi:"हिन्दी" }};

function dataFolder(lang) {{
  if (lang === "en") return "data/";
  return "data_" + lang + "/";
}}

async function packExists(lang) {{
  try {{
    const r = await fetch(dataFolder(lang) + "System.json", {{ cache: "no-store" }});
    return r.ok;
  }} catch (e) {{ return false; }}
}}

async function refreshLangOptions(preferred) {{
  const sel = document.getElementById("lang");
  const codes = ["en","es","zh","pt","hi"];
  const available = [];
  for (const code of codes) {{
    if (await packExists(code)) available.push(code);
  }}
  if (!available.length) available.push("en");
  sel.innerHTML = "";
  for (const code of available) {{
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = (LANG_LABELS[code] || code) + " (" + dataFolder(code).replace(/\\/$/, "") + ")";
    sel.appendChild(opt);
  }}
  if (preferred && available.indexOf(preferred) >= 0) sel.value = preferred;
}}

async function loadPack() {{
  const lang = document.getElementById("lang").value;
  const base = dataFolder(lang);
  const status = document.getElementById("status");
  status.textContent = "Loading " + base + "…";
  status.className = "tag";
  script = [];
  try {{
    if (location.protocol === "file:") {{
      throw new Error("file:// blocked by CORS — run: hk-localize play");
    }}
    const sysResp = await fetch(base + "System.json");
    if (!sysResp.ok) {{
      throw new Error("Pack missing: " + base + " — run translate + apply for " + lang);
    }}
    const sys = await sysResp.json();
    document.title = (sys.gameTitle || "Demo") + " — Reader";
    script.push({{ loc: "Title", text: sys.gameTitle || "Untitled" }});
    for (const name of MAPS) {{
      const map = await fetch(base + name).then(r => r.ok ? r.json() : null);
      if (!map) continue;
      const loc = map.displayName || name;
      for (const ev of (map.events || [])) {{
        if (!ev || !ev.pages) continue;
        for (const page of ev.pages) {{
          for (const cmd of (page.list || [])) {{
            if (cmd && cmd.code === 401 && cmd.parameters && cmd.parameters[0]) {{
              script.push({{ loc, text: String(cmd.parameters[0]) }});
            }}
          }}
        }}
      }}
    }}
    const ce = await fetch(base + "CommonEvents.json").then(r => r.ok ? r.json() : []);
    for (const ev of ce || []) {{
      if (!ev || !ev.list) continue;
      for (const cmd of ev.list) {{
        if (cmd && cmd.code === 401 && cmd.parameters && cmd.parameters[0]) {{
          script.push({{ loc: ev.name || "Common", text: String(cmd.parameters[0]) }});
        }}
      }}
    }}
    i = 0;
    status.textContent = "Loaded " + script.length + " lines · " + lang;
    render();
  }} catch (e) {{
    status.textContent = String(e.message || e);
    status.className = "err";
    document.getElementById("line").textContent = String(e.message || e);
  }}
}}

function render() {{
  if (!script.length) {{
    document.getElementById("line").textContent = "No lines loaded.";
    return;
  }}
  const cur = script[i];
  document.getElementById("loc").textContent = cur.loc;
  document.getElementById("line").textContent = cur.text;
  document.getElementById("idx").textContent = (i+1) + " / " + script.length;
  document.getElementById("bar").style.width = ((i+1)/script.length*100).toFixed(1) + "%";
  document.getElementById("prev").disabled = i <= 0;
  document.getElementById("next").disabled = i >= script.length - 1;
}}

document.getElementById("reload").onclick = loadPack;
document.getElementById("next").onclick = () => {{ if (i < script.length-1) {{ i++; render(); }} }};
document.getElementById("prev").onclick = () => {{ if (i > 0) {{ i--; render(); }} }};
document.getElementById("lang").onchange = () => loadPack();
document.addEventListener("keydown", (e) => {{
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {{ e.preventDefault(); document.getElementById("next").click(); }}
  if (e.key === "ArrowLeft") {{ e.preventDefault(); document.getElementById("prev").click(); }}
}});
(async function boot() {{
  await refreshLangOptions("en");
  await loadPack();
}})();
</script>
</body>
</html>
"""


def write_sample_game(dest: Path) -> Path:
    """Write full PG political chapter + HTML reader."""
    dest = dest.resolve()
    www = dest / "www"
    data = www / "data"
    data.mkdir(parents=True, exist_ok=True)
    (www / "js").mkdir(parents=True, exist_ok=True)
    (www / "js" / "rpg_core.js").write_text(
        "// detector stub — sample is data + HTML reader\n", encoding="utf-8"
    )
    (www / "package.json").write_text(
        json.dumps(
            {
                "name": "the-ballot-and-the-bridge",
                "main": "index.html",
                "window": {
                    "title": "The Ballot and the Bridge",
                    "width": 960,
                    "height": 640,
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    maps = {
        "Map001.json": MAP001,
        "Map002.json": MAP002,
        "Map003.json": MAP003,
        "Map004.json": MAP004,
        "Map005.json": MAP005,
        "Map006.json": MAP006,
        "Map007.json": MAP007,
        "Map008.json": MAP008,
        "Map009.json": MAP009,
        "Map010.json": MAP010,
        "Map011.json": MAP011,
        "Map012.json": MAP012,
    }

    files: dict[str, Any] = {
        "System.json": SYSTEM,
        "Actors.json": ACTORS,
        "Classes.json": CLASSES,
        "Skills.json": SKILLS,
        "Items.json": ITEMS,
        "Weapons.json": WEAPONS,
        "Armors.json": ARMORS,
        "Enemies.json": ENEMIES,
        "States.json": STATES,
        "MapInfos.json": MAP_INFOS,
        "CommonEvents.json": COMMON_EVENTS,
        "Troops.json": [None],
        "Animations.json": [None],
        "Tilesets.json": [None],
        **maps,
    }
    for name, payload in files.items():
        (data / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    map_names = sorted(maps.keys())
    (www / "index.html").write_text(_play_html(map_names), encoding="utf-8")

    (dest / "PLAY.txt").write_text(
        "The Ballot and the Bridge — FULL CHAPTER (PG)\n"
        "============================================\n\n"
        "12 scenes: Plaza, Parliament, Newsroom, Bridge District, Harbor,\n"
        "Continuity HQ, Reform Office, Courthouse, TV Studio, Rural Precinct,\n"
        "Election Night, Epilogue.\n\n"
        "PLAY:  hk-localize play\n"
        "  → http://127.0.0.1:8765/\n"
        "  Do NOT open index.html as file:// (CORS).\n\n"
        "TRANSLATE DEMO:\n"
        "  hk-localize extract\n"
        "  hk-localize translate --langs es,zh,pt,hi\n"
        "  hk-localize apply\n"
        "  hk-localize play  → switch Lang\n",
        encoding="utf-8",
    )
    (dest / "README.txt").write_text(
        "The Ballot and the Bridge — handoffkit-localize sample (PG political).\n"
        "Play: hk-localize play\n",
        encoding="utf-8",
    )
    return dest
