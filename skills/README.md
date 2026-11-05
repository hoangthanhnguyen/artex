Placeholder so the skills bind-mount target exists before the first skill is added.

Add one directory per skill here, each with a SKILL.md at its root:

  skills/<skill-name>/SKILL.md

Compose mounts this folder over /app/skills inside the container, replacing the
copy baked into the image, so editing a skill takes effect on the next task with
no image rebuild.
