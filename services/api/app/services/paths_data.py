"""Path/community config — the Pathfinder question tree, journey stages, warm-up
prompts, and seasonal (emotional-calendar) cards.

Code-config by convention (like personas_data.py): served to clients via the paths
router so the app stays data-driven. Moves to a DB table only when admins need to
edit it live. A community is a LENS (matching preference + tuned copy) — never a
feed; anonymity rails are untouched.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Communities: journey stages (gently named) + warm-up prompts per stage.
# Prompts answer the founder's May ruling: "these people won't know how to ask —
# give them sample questions."
# ---------------------------------------------------------------------------

COMMUNITIES: dict[str, dict] = {
    "upsc": {
        "name": "UPSC",
        "tagline": "For the long road to the services.",
        "stages": {
            "foundation": {
                "title": "Foundation days",
                "blurb": "First year in — finding your feet.",
                "prompts": [
                    "I don't know if I'm studying the right way.",
                    "Everyone seems ahead of me.",
                    "I'm scared I chose the wrong optional.",
                ],
            },
            "mid_prep": {
                "title": "Deep in preparation",
                "blurb": "The long middle — where it gets heavy.",
                "prompts": [
                    "I'm exhausted and the syllabus never ends.",
                    "My family doesn't understand this journey.",
                    "I feel guilty whenever I rest.",
                ],
            },
            "prelims_wait": {
                "title": "The wait after prelims",
                "blurb": "The strange quiet between paper and result.",
                "prompts": [
                    "I keep recalculating my marks.",
                    "My friends think they cleared. I don't.",
                    "I can't start studying again until the result.",
                ],
            },
            "mains_stage": {
                "title": "Mains territory",
                "blurb": "Written the battle, or writing it now.",
                "prompts": [
                    "Mains drained everything out of me.",
                    "I don't know what to do with myself now.",
                    "What if all this writing wasn't enough?",
                ],
            },
            "interview_stage": {
                "title": "The interview wait",
                "blurb": "So close — and somehow that's the hardest part.",
                "prompts": [
                    "I'm anxious about the interview.",
                    "I want to practice talking to someone.",
                    "The waiting is worse than the exam.",
                ],
            },
            "after_setback": {
                "title": "After a setback",
                "blurb": "A result didn't go your way. You're still here.",
                "prompts": [
                    "The result came and it wasn't mine.",
                    "I don't know whether to try again.",
                    "Everyone keeps asking me what's next.",
                ],
            },
        },
        # Emotional calendar (month-day ranges, year-agnostic). Founder's 7 timings.
        "seasonal": [
            {
                "from": "05-24",
                "to": "06-07",
                "title": "Prelims just happened.",
                "body": "However it went, you're welcome here. A lot of people are sitting with the same feeling.",
            },
            {
                "from": "06-08",
                "to": "07-05",
                "title": "The result wait.",
                "body": "The space between paper and result is heavy for everyone. You don't have to carry it alone.",
            },
            {
                "from": "09-15",
                "to": "10-05",
                "title": "Mains season.",
                "body": "Writing mains is a feat. Whatever stage you're at — someone here has walked it.",
            },
            {
                "from": "12-01",
                "to": "12-20",
                "title": "Interview months.",
                "body": "The last mile has its own weight. Talk it out with someone who's been in that room.",
            },
        ],
    },
    "neet": {
        "name": "NEET",
        "tagline": "For everyone chasing the white coat.",
        "stages": {
            "first_attempt": {
                "title": "First attempt",
                "blurb": "New to the grind.",
                "prompts": [
                    "The competition numbers scare me.",
                    "I can't tell if my coaching is enough.",
                    "Biology loves me, physics doesn't.",
                ],
            },
            "repeat_year": {
                "title": "The repeat year",
                "blurb": "Doing it again takes a different kind of courage.",
                "prompts": [
                    "Everyone from school moved on except me.",
                    "I'm scared of another year ending the same way.",
                    "My parents sacrificed a lot for this attempt.",
                ],
            },
            "results_wait": {
                "title": "Results on the horizon",
                "blurb": "The wait, the what-ifs.",
                "prompts": [
                    "I keep imagining every possible rank.",
                    "What if I don't get a seat anywhere?",
                ],
            },
        },
        "seasonal": [
            {
                "from": "05-01",
                "to": "05-15",
                "title": "Exam week energy.",
                "body": "NEET days are heavy days. Whatever happens in that hall, you're more than a rank.",
            },
            {
                "from": "06-01",
                "to": "06-20",
                "title": "Results season.",
                "body": "Ranks are loud right now. Your worth isn't. Talk to someone who gets it.",
            },
        ],
    },
    "jee": {
        "name": "JEE",
        "tagline": "For the ones wrestling with the toughest papers in the country.",
        "stages": {
            "grinding": {
                "title": "In the grind",
                "blurb": "Mains, advanced, mocks — the treadmill.",
                "prompts": [
                    "My percentile doesn't match my effort.",
                    "I'm tired of mock test Sundays.",
                    "Coaching pace is crushing me.",
                ],
            },
            "drop_year": {
                "title": "Drop year",
                "blurb": "One more year, one more shot.",
                "prompts": [
                    "Taking a drop felt right, now I'm not sure.",
                    "I see my friends in college and it stings.",
                ],
            },
        },
        "seasonal": [
            {
                "from": "01-20",
                "to": "02-05",
                "title": "Mains season.",
                "body": "Attempt one is done or near. Breathe. You have people here.",
            },
            {
                "from": "05-15",
                "to": "06-10",
                "title": "Advanced and after.",
                "body": "However the paper went, the pressure is real and so is the support here.",
            },
        ],
    },
    "exams": {
        "name": "Other exams",
        "tagline": "CA, state services, banking, boards — every hard exam counts.",
        "stages": {
            "preparing": {
                "title": "In preparation",
                "blurb": "Doing the work, carrying the weight.",
                "prompts": [
                    "This exam has taken over my whole life.",
                    "I'm losing touch with my friends.",
                    "Some days I can't open the books at all.",
                ],
            },
            "results_wait": {
                "title": "Waiting on a result",
                "blurb": "The part nobody prepares you for.",
                "prompts": [
                    "The wait is making me spiral.",
                    "I keep replaying my mistakes.",
                ],
            },
        },
        "seasonal": [],
    },
    "life": {
        "name": "Life",
        "tagline": "No exam. Just life, and someone to talk to.",
        "stages": {
            "heavy_days": {
                "title": "Heavy days",
                "blurb": "When it's just a lot right now.",
                "prompts": [
                    "Today felt heavy.",
                    "I haven't said this out loud to anyone.",
                    "I'm okay, but I'm also not.",
                ],
            },
            "crossroads": {
                "title": "At a crossroads",
                "blurb": "Career, courses, big decisions.",
                "prompts": [
                    "I don't know which way to go next.",
                    "Everyone has an opinion about my life.",
                    "How did you decide what to do?",
                ],
            },
            "open_door": {
                "title": "Open door",
                "blurb": "No agenda. Just a conversation.",
                "prompts": [
                    "I just want to talk to someone.",
                    "Tell me it gets lighter.",
                ],
            },
        },
        "seasonal": [],
    },
}

# ---------------------------------------------------------------------------
# Pathfinder question tree. Leaf options carry {community, stage}; branch options
# carry {next}. The client walks this blindly — adding a community is config.
# ---------------------------------------------------------------------------

TREE_ROOT = "q_root"

TREE: dict[str, dict] = {
    "q_root": {
        "question": "What brings you here these days?",
        "options": [
            {"label": "I'm preparing for an exam", "icon": "school-outline", "next": "q_exam"},
            {
                "label": "Life feels heavy right now",
                "icon": "cloudy-outline",
                "community": "life",
                "stage": "heavy_days",
            },
            {
                "label": "I'm at a crossroads about my direction",
                "icon": "git-branch-outline",
                "community": "life",
                "stage": "crossroads",
            },
            {
                "label": "I just want someone to talk to",
                "icon": "chatbubble-ellipses-outline",
                "community": "life",
                "stage": "open_door",
            },
        ],
    },
    "q_exam": {
        "question": "Which road are you on?",
        "options": [
            {"label": "UPSC", "icon": "library-outline", "next": "q_upsc_stage"},
            {"label": "NEET", "icon": "medkit-outline", "next": "q_neet_stage"},
            {"label": "JEE", "icon": "calculator-outline", "next": "q_jee_stage"},
            {"label": "A different exam", "icon": "ribbon-outline", "next": "q_exams_stage"},
        ],
    },
    "q_upsc_stage": {
        "question": "Where are you on the road?",
        "options": [
            {"label": "Just starting out", "community": "upsc", "stage": "foundation"},
            {"label": "Deep in preparation", "community": "upsc", "stage": "mid_prep"},
            {"label": "Waiting after prelims", "community": "upsc", "stage": "prelims_wait"},
            {"label": "Mains — written or writing", "community": "upsc", "stage": "mains_stage"},
            {"label": "Interview stage", "community": "upsc", "stage": "interview_stage"},
            {"label": "Regrouping after a setback", "community": "upsc", "stage": "after_setback"},
        ],
    },
    "q_neet_stage": {
        "question": "Where are you on the road?",
        "options": [
            {"label": "First attempt", "community": "neet", "stage": "first_attempt"},
            {"label": "Repeat year", "community": "neet", "stage": "repeat_year"},
            {"label": "Waiting for results", "community": "neet", "stage": "results_wait"},
        ],
    },
    "q_jee_stage": {
        "question": "Where are you on the road?",
        "options": [
            {"label": "In the grind", "community": "jee", "stage": "grinding"},
            {"label": "Drop year", "community": "jee", "stage": "drop_year"},
        ],
    },
    "q_exams_stage": {
        "question": "Where are you on the road?",
        "options": [
            {"label": "In preparation", "community": "exams", "stage": "preparing"},
            {"label": "Waiting on a result", "community": "exams", "stage": "results_wait"},
        ],
    },
}
