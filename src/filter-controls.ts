// Change enabled state without rerendering unsaved form values.
export const syncOptionalControls = (form: HTMLFormElement): void => {
  const chooser = form.querySelector<HTMLInputElement>("#choose-books");
  const selection = form.querySelector<HTMLFieldSetElement>("#included-books");
  if (chooser && selection) {
    selection.disabled = !chooser.checked;
    selection.hidden = !chooser.checked;
  }
  form
    .querySelectorAll<HTMLSelectElement>("select[data-controls]")
    .forEach((mode) => {
      const target = form.querySelector<HTMLInputElement>(
        `#${mode.dataset.controls}`,
      );
      if (target) target.disabled = mode.value === "any";
    });
};
