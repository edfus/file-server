class DirentList extends HTMLElement {
  constructor() {
    super();
    this._hide();
    this.options = [];

    this._observer = new MutationObserver(mutationsList => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'attributes' && mutation.attributeName === "for") {
          this.bindInput(document.getElementById(this.getAttribute("for")));
          continue;
        }
         
        if(mutation.type === "childList" && mutation.addedNodes.length) {
          this.bindOptions(mutation.addedNodes);
        }

        if(mutation.type === "childList" && mutation.removedNodes.length) {
          this.removeOptions(mutation.removedNodes);
        }
      }
    });

    this._observer.observe(this, { attributes: true, childList: true });
    window.addEventListener("resize", this._inputResizeListener, { passive: true });

    this._resizeObserver = new ResizeObserver(
      entries => {
        this._inputResizeListener();
        for (let entry of entries) {
          if(entry.contentBoxSize) {
            // Firefox implements `contentBoxSize` as a single content rect, rather than an array
            const contentBoxSize = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize;

            this.style.fontSize = `${Math.min(.6, Math.max(contentBoxSize.inlineSize / 600, .45))}rem`;
          } else {
            this.style.fontSize = `${Math.min(.6, Math.max(entry.contentRect.width / 600, .45))}rem`;
          }
        }
      }
    );

    if(this.getAttribute("reverse") !== null) {
      new ResizeObserver(
        () => {
          this.style.top = `${this._input?.offsetTop - this.offsetHeight}px`
        }
      ).observe(this);
    }

    if (this.children.length) {
      this.bindOptions(this.children);
    }

    if (this.getAttribute("for")) {
      this.bindInput(document.getElementById(this.getAttribute("for")));
    }

    this.addEventListener("mouseenter",  () => this._isFocus = true,  { passive: true });
    this.addEventListener("mouseleave", () => this._isFocus = false, { passive: true });
  }

  _resetOptionStyle = () => {
    this.options.forEach(e => e.classList.remove("active"));
  }

  _dropdownIndex = -1;

  _inputKeyDownListener = event => {
    switch (event.key) {
      case "ArrowDown":
        this._resetOptionStyle();

        if(++this._dropdownIndex >= this.dropdowns.length)
          return this.dropdowns[this._dropdownIndex = this.dropdowns.length - 1].classList.add("active");

        event.preventDefault();

        if(this._dropdownIndex === 0)
          this._show();

        this.dropdowns[this._dropdownIndex].classList.add("active");

        break;
      case "ArrowUp":
        this._resetOptionStyle();

        if(this._dropdownIndex < 0)
          return this._dropdownIndex = -1;

        if(this._dropdownIndex > this.dropdowns.length)
          this._dropdownIndex = this.dropdowns.length;
        
        event.preventDefault();

        if(--this._dropdownIndex < 0) {
          this._hide();
        } else {
          this.dropdowns[this._dropdownIndex].classList.add("active");
        }
        break;
      default:
        break;
    }
  }

  _inputKeyUpListener = event => {
    if(event.key === "Enter") {
      this._resetOptionStyle(); //
      if(this._dropdownIndex >= 0 && this._dropdownIndex < this.dropdowns.length && !this.hidden) {
        this.dropdowns[this._dropdownIndex].click();
        event.stopImmediatePropagation();
        event.preventDefault();

        event.returnValue = false;
        return false;
      }
    }
  }

  _inputFocusListener = () => {
    this._show();
  };

  _debounce = {
    in: false,
    timer: -1,
    timeout: 100
  }

  _updateDropdowns (value) {
    if(this._debounce.in) {
      clearTimeout(this._debounce.timer);
    } else {
      this._debounce.in = true;
    }

    this._debounce.timer = setTimeout(
      () => {
        const v = String(value || this._input?.value || "");
        this.dropdowns = this.options.filter(
          option => {
            const shouldHide = !option.value.startsWith(v);
            if(option.hidden !== shouldHide)
              option.hidden = shouldHide;
            return !shouldHide;
          }
        );
        this._debounce.in = false;
      },
      this._debounce.timeout
    );
  }

  _inputValueChangeListener = event => {
    this._updateDropdowns(event.target.value);
  };

  _inputBlurListener = () => {
    if(!this._isFocus) {
      this._hide();
    }
  };

  _resizeThrottle = {
    in: false,
    timer: -1,
    timeout: 30
  }

  _inputResizeListener = () => {
    if(this._resizeThrottle.in) {
      return ;
    } else {
      this._resizeThrottle.in = true;
      setTimeout(() => {
        this._resizeThrottle.in = false;
        this.style.width = `${this._input?.offsetWidth}px`;
        this.style.left = `${this._input?.offsetLeft}px`;
        if(this.getAttribute("reverse") === null)
          this.style.top = `${this._input?.offsetTop + this._input?.offsetHeight}px`;
      }, this._resizeThrottle.timeout)
    }
  }

  _show () {
    if(this.hidden)
      this.hidden = false;
  }

  _hide () {
    this._dropdownIndex = -1;
    this.hidden = true;
  }

  removeOptions (children) {
    const nodes = Array.from(children);
    const toDelete = nodes.filter(node => node.nodeName === "OPTION");
    this.options = this.options.filter(
      option => !toDelete.includes(option)
    );
    this._debounce.timeout = this.options.length * 3;
    this._updateDropdowns();
  }

  bindOptions (children) {
    for (const node of children) {
      if(node.nodeName === "OPTION") {
        node.onclick = () => {
          this._input.value = node.value;
          this._input.dispatchEvent(new InputEvent("input", {
            inputType: "inserting",
            data: node.value,
            isComposing: false
          }));
          setTimeout(() => {
            this._input.focus();
            this._input.setSelectionRange(node.value.length, node.value.length);
          }, 0);
        };
        const span = document.createElement("SPAN");
        span.innerText = node.value;
        node.appendChild(span);

        this.options.push(node);

        node.hidden = true;
      }
    }
    this._debounce.timeout = this.options.length * 3;
    this._updateDropdowns();
  }

  bindInput (input) {
    if (this._input) {
      this._removeListeners(this._input);
    }

    this._addListeners(input);
    this._input = input;

    this._inputResizeListener();

    if(document.activeElement === input) {
      this._inputFocusListener();
    }
  }

  _addListeners (input) {
    input.addEventListener("focus", this._inputFocusListener, { passive: true });
    input.addEventListener("click", this._inputFocusListener, { passive: true });
    input.addEventListener("blur", this._inputBlurListener, { passive: true });
    input.addEventListener("input", this._inputValueChangeListener, { passive: true });
      
    input.onkeyup = this._inputKeyUpListener;
    input.onkeydown = this._inputKeyDownListener;

    this._resizeObserver.observe(input);
  }

  _removeListeners (input) {
    input.removeEventListener("focus", this._inputFocusListener, { passive: true });
    input.removeEventListener("click", this._inputFocusListener, { passive: true });
    input.removeEventListener("blur", this._inputBlurListener, { passive: true });
    input.removeEventListener("input", this._inputValueChangeListener, { passive: true });

    if(input.onkeydown === this._inputKeyDownListener)
      input.onkeydown = null;

    if(input.onkeyup === this._inputKeyUpListener)
      input.onkeyup = null;
    
    this._resizeObserver.unobserve(input);
  }

  remove() {
    this._observer.disconnect();
    this._resizeObserver.disconnect();
    window.removeEventListener("resize", this._inputResizeListener, { passive: true });
    if (this._input) {
      this._removeListeners(this._input);
    }
    return super.remove();
  }
}

customElements.define("dirent-list", DirentList);