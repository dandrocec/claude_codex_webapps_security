(function () {
  const list = document.querySelector("#questions");
  const addButton = document.querySelector("#add-question");
  const template = document.querySelector("#question-template");

  function refreshRequiredValues() {
    list.querySelectorAll(".question-row").forEach((row, index) => {
      const required = row.querySelector('input[name="required"]');
      required.value = String(index);
    });
  }

  function bindRemove(row) {
    row.querySelector(".remove").addEventListener("click", () => {
      if (list.querySelectorAll(".question-row").length === 1) {
        row.querySelector('input[name="prompt"]').value = "";
        return;
      }
      row.remove();
      refreshRequiredValues();
    });
  }

  list.querySelectorAll(".question-row").forEach(bindRemove);

  addButton.addEventListener("click", () => {
    const clone = template.content.firstElementChild.cloneNode(true);
    bindRemove(clone);
    list.appendChild(clone);
    refreshRequiredValues();
    clone.querySelector('input[name="prompt"]').focus();
  });

  refreshRequiredValues();
})();
