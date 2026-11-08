"""More exam roads for the Path (docs/DECISIONS.md §N.5): the common Indian exams as one-tap
choices, each with the stages people actually pass through and the sentences they find hard
to start with. Merged into `paths_data.COMMUNITIES` and `paths_data.TREE` at import.

Every road is an exam niche: a request from a member on one waits for a mentor's accept
(`accept_first`, §N.2). Life in general keeps the instant match. Communities stay a LENS
(a soft matching preference and tuned copy), never a gate; anonymity rails are untouched.
"""

from __future__ import annotations


def _stages(start: tuple, deep: tuple, wait: tuple, setback: tuple) -> dict[str, dict]:
    keys = ("starting", "deep_prep", "result_wait", "setback")
    return {
        key: {"title": title, "blurb": blurb, "prompts": list(prompts)}
        for key, (title, blurb, prompts) in zip(keys, (start, deep, wait, setback), strict=True)
    }


# slug -> (name, icon, tagline, stages). Names are the exam families people say out loud.
EXAM_ROADS: dict[str, tuple[str, str, str, dict[str, dict]]] = {
    "ssc": (
        "SSC",
        "document-text-outline",
        "CGL, CHSL, MTS, JE and the rest of the SSC calendar.",
        _stages(
            (
                "Starting out",
                "Picking the exam and the plan.",
                [
                    "I don't know which SSC exam to aim for.",
                    "Everyone says it's easy, so why am I scared?",
                    "I'm starting late and feel behind.",
                ],
            ),
            (
                "Deep in preparation",
                "Tier after tier of mocks.",
                [
                    "My mock scores swing every week.",
                    "I'm tired of the same practice papers.",
                    "I'm balancing a job and this, and losing at both.",
                ],
            ),
            (
                "Waiting on a result",
                "Notices slip and the date keeps moving.",
                [
                    "The result date keeps getting pushed.",
                    "I can't plan anything until the cutoff.",
                    "I keep checking the notice board.",
                ],
            ),
            (
                "After a setback",
                "A cutoff missed by a mark or two.",
                [
                    "I missed the cutoff by so little.",
                    "I don't know if I should attempt again.",
                    "My family wants me to take any job now.",
                ],
            ),
        ),
    ),
    "banking": (
        "Banking & insurance",
        "business-outline",
        "IBPS, SBI, RBI Grade B, LIC and the bank calendar.",
        _stages(
            (
                "Starting out",
                "Learning the pattern and the speed.",
                [
                    "The sectional timing scares me.",
                    "I can't tell which bank exam suits me.",
                    "I started late and everyone sounds ahead.",
                ],
            ),
            (
                "Deep in preparation",
                "Speed, accuracy, repeat.",
                [
                    "My accuracy drops under the timer.",
                    "I fail one section and it ruins the day.",
                    "I'm working full-time and studying at night.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Prelims, mains, interview, one after another.",
                [
                    "Every stage resets the waiting.",
                    "I can't tell how the paper went.",
                    "I'm anxious until the cutoff is out.",
                ],
            ),
            (
                "After a setback",
                "Close, but not this time.",
                [
                    "I missed the sectional cutoff.",
                    "I'm thinking of quitting banking exams.",
                    "I feel I wasted another year.",
                ],
            ),
        ),
    ),
    "railways": (
        "Railways",
        "train-outline",
        "RRB NTPC, Group D, JE and ALP.",
        _stages(
            (
                "Starting out",
                "A huge vacancy list and a long syllabus.",
                [
                    "There are so many posts I can't choose.",
                    "I'm not sure I can compete with this many people.",
                    "I haven't studied in years.",
                ],
            ),
            (
                "Deep in preparation",
                "CBT after CBT.",
                [
                    "The normalisation scores confuse me.",
                    "I can't keep my focus for a long paper.",
                    "I study in a crowded house.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Dates, shifts, and long silences.",
                [
                    "The exam date keeps changing.",
                    "I don't know how my shift went.",
                    "The wait for the result is endless.",
                ],
            ),
            (
                "After a setback",
                "Another notification, another attempt?",
                [
                    "I didn't make it past the CBT.",
                    "I'm tired of starting over.",
                    "People at home say it's time to stop.",
                ],
            ),
        ),
    ),
    "psc": (
        "State PSC & state exams",
        "map-outline",
        "State civil services, police and other state recruitment.",
        _stages(
            (
                "Starting out",
                "Learning the state-specific syllabus.",
                [
                    "The state syllabus feels endless.",
                    "I'm not sure whether to try UPSC too.",
                    "I don't have good material in my language.",
                ],
            ),
            (
                "Deep in preparation",
                "A long cycle with uncertain dates.",
                [
                    "Notifications come late and I lose momentum.",
                    "I'm studying alone in a small town.",
                    "Everyone around me has a job already.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Paper leaks, delays, court cases.",
                [
                    "The exam got postponed again.",
                    "I'm worried about a leak or cancellation.",
                    "I can't plan my life around these dates.",
                ],
            ),
            (
                "After a setback",
                "Another cycle gone.",
                [
                    "I missed the final list by a few ranks.",
                    "I'm out of attempts or age.",
                    "I don't know what to say to my family.",
                ],
            ),
        ),
    ),
    "defence": (
        "Defence",
        "shield-outline",
        "NDA, CDS, AFCAT, Agniveer and the services' entry exams.",
        _stages(
            (
                "Starting out",
                "Written paper, then the SSB.",
                [
                    "I'm not sure I'm fit enough for this.",
                    "The age limit makes me feel rushed.",
                    "I don't know anyone who has done this.",
                ],
            ),
            (
                "Deep in preparation",
                "Books, fitness and the interview, together.",
                [
                    "Studying and training both leave me exhausted.",
                    "I get nervous about the group tasks.",
                    "I'm afraid of failing a medical.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Written results, SSB calls, medicals.",
                [
                    "I'm waiting for the SSB call letter.",
                    "The medical result is all I think about.",
                    "I can't relax until the merit list.",
                ],
            ),
            (
                "After a setback",
                "Screened out or not recommended.",
                [
                    "I was screened out at the SSB.",
                    "I'm running out of attempts.",
                    "I don't know who I am if I'm not in uniform.",
                ],
            ),
        ),
    ),
    "teaching": (
        "Teaching (CTET & TET)",
        "easel-outline",
        "CTET, state TETs and teacher recruitment.",
        _stages(
            (
                "Starting out",
                "Eligibility first, vacancies later.",
                [
                    "I don't know if teaching is really for me.",
                    "The B.Ed. and the TET both feel like a lot.",
                    "I'm worried there won't be any vacancies.",
                ],
            ),
            (
                "Deep in preparation",
                "Child pedagogy, subject papers, repeat.",
                [
                    "I forget what I studied last month.",
                    "The pedagogy paper trips me up.",
                    "I'm teaching in a small school while I study.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Eligibility done, posting not.",
                [
                    "I passed but there are no vacancies.",
                    "The recruitment keeps getting delayed.",
                    "I'm waiting on counselling and a posting.",
                ],
            ),
            (
                "After a setback",
                "A paper missed by a few marks.",
                [
                    "I missed the TET by two marks.",
                    "I'm tired of waiting on notifications.",
                    "I don't know if I should look for another job.",
                ],
            ),
        ),
    ),
    "gate": (
        "GATE & engineering PSU",
        "construct-outline",
        "GATE, ESE and PSU recruitment.",
        _stages(
            (
                "Starting out",
                "Choosing a branch paper and a plan.",
                [
                    "I forgot my college basics.",
                    "I can't decide between a job and M.Tech.",
                    "I'm preparing while working.",
                ],
            ),
            (
                "Deep in preparation",
                "Numericals, mocks and revision.",
                [
                    "My rank prediction scares me.",
                    "I can't hold the whole syllabus in my head.",
                    "I'm losing motivation at the revision stage.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Score, cutoffs, interviews.",
                [
                    "I'm refreshing the score page.",
                    "The PSU cutoffs aren't out yet.",
                    "I don't know how to prepare for the interview.",
                ],
            ),
            (
                "After a setback",
                "A score that fell short of the plan.",
                [
                    "My GATE score was lower than I expected.",
                    "I feel the whole year was wasted.",
                    "I'm afraid to attempt again.",
                ],
            ),
        ),
    ),
    "cuet": (
        "CUET & college entry",
        "school-outline",
        "CUET and state or university entrance exams.",
        _stages(
            (
                "Starting out",
                "Which subjects, which colleges.",
                [
                    "I'm not sure which course I really want.",
                    "My marks and my interests don't match.",
                    "I'm the first in my family to do this.",
                ],
            ),
            (
                "Deep in preparation",
                "Domain subjects and a general test.",
                [
                    "I can't balance boards and entrance prep.",
                    "The syllabus is vague and I panic.",
                    "I compare myself to everyone online.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Scores, then rounds of seat allocation.",
                [
                    "The seat allocation rounds are stressful.",
                    "I may not get the college I wanted.",
                    "I'm waiting and can't plan the year.",
                ],
            ),
            (
                "After a setback",
                "Not the college you pictured.",
                [
                    "I didn't get into my first-choice college.",
                    "I'm thinking of taking a gap year.",
                    "My parents are disappointed.",
                ],
            ),
        ),
    ),
    "law": (
        "Law (CLAT)",
        "scale-outline",
        "CLAT, AILET and other law entrance exams.",
        _stages(
            (
                "Starting out",
                "Reading, reasoning and the legal aptitude.",
                [
                    "I'm not sure I'm a good reader.",
                    "I don't know anyone in law.",
                    "I'm worried I picked this for the wrong reasons.",
                ],
            ),
            (
                "Deep in preparation",
                "Passage after passage, mock after mock.",
                [
                    "My reading speed isn't improving.",
                    "Current affairs feels endless.",
                    "I'm losing confidence after a bad mock.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Rank lists and counselling.",
                [
                    "I'm waiting for the rank list.",
                    "I don't know which NLU I'll get.",
                    "The counselling choices are stressing me.",
                ],
            ),
            (
                "After a setback",
                "Missed the NLU you wanted.",
                [
                    "I didn't get a good NLU.",
                    "I'm wondering about taking a drop.",
                    "I feel I let my family down.",
                ],
            ),
        ),
    ),
    "mba": (
        "CAT & MBA",
        "stats-chart-outline",
        "CAT, XAT, GMAT and the interview rounds.",
        _stages(
            (
                "Starting out",
                "Quant, verbal, and a long calendar.",
                [
                    "I'm weak at quant and it scares me.",
                    "I'm working and have little time.",
                    "I'm not sure an MBA is the right move.",
                ],
            ),
            (
                "Deep in preparation",
                "Mocks, percentile and sectional balance.",
                [
                    "My percentile keeps bouncing.",
                    "I'm exhausted by the mock cycle.",
                    "I compare my scores to everyone on the forums.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Calls, GD-PI and final lists.",
                [
                    "I'm waiting for the interview calls.",
                    "I'm anxious about the group discussion.",
                    "The final list is taking forever.",
                ],
            ),
            (
                "After a setback",
                "No call from the colleges you wanted.",
                [
                    "I didn't get a call from my dream colleges.",
                    "Should I take another year?",
                    "I feel stuck in my job.",
                ],
            ),
        ),
    ),
    "ugcnet": (
        "UGC NET & research",
        "flask-outline",
        "UGC NET, CSIR NET and the road to teaching and research.",
        _stages(
            (
                "Starting out",
                "A big syllabus and a small window.",
                [
                    "I'm not sure I want an academic career.",
                    "I'm preparing with a job and a family.",
                    "I don't know how to cover two papers.",
                ],
            ),
            (
                "Deep in preparation",
                "Paper 1 and your subject.",
                [
                    "I can't finish the subject syllabus.",
                    "I'm lonely while I study.",
                    "I keep losing my revision rhythm.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "Cutoffs and certificates.",
                [
                    "I'm waiting on the cutoff for JRF.",
                    "The result date is not announced.",
                    "I can't decide what to do next.",
                ],
            ),
            (
                "After a setback",
                "Qualified or just short.",
                [
                    "I missed the cutoff by a few marks.",
                    "I'm worried I'll never get into a department.",
                    "I'm questioning my whole path.",
                ],
            ),
        ),
    ),
    "ca": (
        "CA, CS & CMA",
        "calculator-outline",
        "The professional exams: CA, CS and CMA.",
        _stages(
            (
                "Starting out",
                "Foundation and a very long road.",
                [
                    "I'm worried about the pass percentage.",
                    "My family expects me to be a CA.",
                    "I don't know if I can study for this many years.",
                ],
            ),
            (
                "Deep in preparation",
                "Inter, articleship, repeat.",
                [
                    "Articleship leaves me no time to study.",
                    "I fail by a few marks again and again.",
                    "I'm burned out and still have papers left.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "The results day dread.",
                [
                    "I can't sleep before the result.",
                    "I'm afraid to open the result page.",
                    "I don't know how the paper went.",
                ],
            ),
            (
                "After a setback",
                "A paper failed, again.",
                [
                    "I failed one group by a mark.",
                    "I feel everyone around me is moving on.",
                    "I'm wondering if I should quit.",
                ],
            ),
        ),
    ),
    "boards": (
        "Board exams (10 & 12)",
        "reader-outline",
        "Class 10 and 12 boards and the pressure around them.",
        _stages(
            (
                "Starting out",
                "A new year and a heavy syllabus.",
                [
                    "I don't know how to start studying.",
                    "Everyone at home keeps talking about marks.",
                    "I'm worried about my stream choice.",
                ],
            ),
            (
                "Deep in preparation",
                "Revision, tuition, pre-boards.",
                [
                    "I can't concentrate for long.",
                    "My tuition and school clash.",
                    "I'm scared of disappointing my parents.",
                ],
            ),
            (
                "Waiting on an exam or result",
                "After the paper, before the result.",
                [
                    "I made mistakes in the paper and can't stop thinking.",
                    "The result day is coming.",
                    "I'm afraid to tell my family my marks.",
                ],
            ),
            (
                "After a setback",
                "Marks that didn't match the effort.",
                [
                    "My marks were lower than I hoped.",
                    "I don't know what to say at home.",
                    "I'm unsure what to do next.",
                ],
            ),
        ),
    ),
}

# Where each road sits in the "Which road are you on?" tree, so the common ones are one
# tap away and the rest are grouped, not buried in one long list.
GROUPS: dict[str, tuple[str, str, list[str]]] = {
    "q_exam_gov": (
        "Government jobs",
        "briefcase-outline",
        ["ssc", "banking", "railways", "psc", "defence", "teaching"],
    ),
    "q_exam_study": (
        "Entrance & professional exams",
        "school-outline",
        ["gate", "cuet", "law", "mba", "ugcnet", "ca", "boards"],
    ),
}
STAGE_LABELS = (
    ("starting", "Just starting out"),
    ("deep_prep", "Deep in preparation"),
    ("result_wait", "Waiting on an exam or result"),
    ("setback", "Regrouping after a setback"),
)


def communities() -> dict[str, dict]:
    return {
        slug: {
            "name": name,
            "tagline": tagline,
            "accept_first": True,
            "icon": icon,
            "stages": stages,
        }
        for slug, (name, icon, tagline, stages) in EXAM_ROADS.items()
    }


def tree() -> dict[str, dict]:
    nodes: dict[str, dict] = {}
    for slug, (name, _icon, _tagline, _stages_) in EXAM_ROADS.items():
        nodes[f"q_{slug}_stage"] = {
            "question": "Where are you on the road?",
            "options": [
                {"label": label, "community": slug, "stage": stage} for stage, label in STAGE_LABELS
            ],
        }
    for node, (title, icon, slugs) in GROUPS.items():
        nodes[node] = {
            "question": f"{title}: which exam?",
            "options": [
                {
                    "label": EXAM_ROADS[slug][0],
                    "icon": EXAM_ROADS[slug][1],
                    "next": f"q_{slug}_stage",
                }
                for slug in slugs
            ],
        }
    return nodes


# Stages that were missing from the roads already in `paths_data` (JEE and NEET get the
# extra shortcuts the founder asked for: the clash with school, and the counselling wait).
EXTRA_STAGES: dict[str, dict[str, dict]] = {
    "jee": {
        "class_11_12": {
            "title": "Class 11–12 and JEE together",
            "blurb": "Boards, school and JEE pulling in three directions.",
            "prompts": [
                "I can't balance boards and JEE.",
                "Coaching and school leave me no time.",
                "I'm scared of a bad start in class 11.",
            ],
        },
        "advanced_wait": {
            "title": "Waiting for Advanced or the result",
            "blurb": "Mains done, Advanced ahead, or a rank on the way.",
            "prompts": [
                "I keep predicting my rank.",
                "I'm afraid I won't clear Advanced.",
                "I can't study until I know.",
            ],
        },
        "counselling_wait": {
            "title": "Counselling and the seat wait",
            "blurb": "JoSAA rounds, choices and the branch question.",
            "prompts": [
                "I don't know whether to choose branch or college.",
                "Every round changes my mind.",
                "I might not get the seat I worked for.",
            ],
        },
    },
    "neet": {
        "class_12_clash": {
            "title": "Class 12 and NEET together",
            "blurb": "Boards and NEET at the same time.",
            "prompts": [
                "I'm torn between boards and NEET.",
                "School and coaching take every hour.",
                "I'm scared my marks won't be enough.",
            ],
        },
        "counselling_wait": {
            "title": "Counselling and the seat wait",
            "blurb": "Rounds, colleges and the cutoff question.",
            "prompts": [
                "I don't know which college to pick.",
                "I'm afraid of ending up with nothing.",
                "The rounds keep dragging on.",
            ],
        },
    },
}
EXTRA_OPTIONS: dict[str, list[dict]] = {
    "q_jee_stage": [
        {"label": "Class 11–12 and JEE together", "community": "jee", "stage": "class_11_12"},
        {
            "label": "Waiting for Advanced or the result",
            "community": "jee",
            "stage": "advanced_wait",
        },
        {"label": "Counselling and the seat wait", "community": "jee", "stage": "counselling_wait"},
    ],
    "q_neet_stage": [
        {"label": "Class 12 and NEET together", "community": "neet", "stage": "class_12_clash"},
        {
            "label": "Counselling and the seat wait",
            "community": "neet",
            "stage": "counselling_wait",
        },
    ],
}
# The existing exam roads, as exam niches (§N.2); `life` is not one.
EXISTING_EXAM_NICHES = ("upsc", "neet", "jee", "exams")


def extend(communities_: dict[str, dict], tree_: dict[str, dict]) -> None:
    """Merge everything above into the live config, without touching an existing id."""
    communities_.update(communities())
    tree_.update(tree())
    for slug in EXISTING_EXAM_NICHES:
        communities_[slug]["accept_first"] = True
    for slug, stages in EXTRA_STAGES.items():
        communities_[slug]["stages"].update(stages)
    for node, options in EXTRA_OPTIONS.items():
        tree_[node]["options"].extend(options)
    tree_["q_exam"]["options"] = [
        {"label": "UPSC", "icon": "library-outline", "next": "q_upsc_stage"},
        {"label": "NEET", "icon": "medkit-outline", "next": "q_neet_stage"},
        {"label": "JEE", "icon": "calculator-outline", "next": "q_jee_stage"},
        *[
            {"label": title, "icon": icon, "next": node}
            for node, (title, icon, _slugs) in GROUPS.items()
        ],
        {"label": "A different exam", "icon": "ribbon-outline", "next": "q_exams_stage"},
    ]
