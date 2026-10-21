# Course Syllabi & Grade Weighting

This directory is reserved for user-supplied course syllabus documents.

## Privacy & Open Source Guidelines
To protect faculty and institutional privacy, proprietary course syllabus PDFs are omitted from this public repository. Blackboarder provides sample syllabus weighting configurations in code (`src/core/syllabusWeights.ts` and `src/core/userCourses.ts`), which students can customize directly in the Blackboarder UI (under the **Syllabus / Weights** tab) or by editing their course configuration.

## Adding Custom Syllabi
You can place your course syllabus PDFs here for local analysis:
- `docs/syllabus/calc_1.pdf` - Calculus I Syllabus
- `docs/syllabus/phy1.pdf` - Physics 1 Syllabus
- `docs/syllabus/phy1lab.pdf` - Physics 1 Lab Syllabus
- `docs/syllabus/introtocompeng.pdf` - Intro to Computer Engineering Syllabus
- `docs/syllabus/eap.pdf` - English for Academic Purposes Syllabus
- `docs/syllabus/islamicculture.pdf` - Islamic Culture Syllabus

## Helper Scripts
- `scripts/parsePhy1.py`: Parses locally added Physics 1 syllabus text and extracts grade distributions.
