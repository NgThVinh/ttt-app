Components adapted from https://ui.shadcn.com/r/styles/new-york/{button,input,card,skeleton}.json on 2026-11-22. MIT license in LICENSE.md. Touch sizing and palette customized for 3T.

Calendar, DateTimeField, Badge and Table are original repository components (2026-11-23). Calendar uses Monday-first Vietnamese date labels and keyboard navigation; date-time fields retain their native inputs and server validation. No additional runtime dependencies.

SlidingTabs and AnimatedDisclosure (2026-11-24) wire transitions.dev recipes 16 (sliding tabs) and 21 (accordion); the app theme switch uses recipe 09 (icon swap). CSS recipes and reduced-motion guards are preserved in `src/app/motion.css`, with app-specific sizing and palette overrides in `src/app/theme.css`. Installed from the local `transitions-dev` skill under its product-use license (`.agents/skills/transitions-dev/LICENSE.txt`); no animation dependency added.
