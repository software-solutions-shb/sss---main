/**
 * ============================================
 * FORM.JS - Business Details Form Handler
 * Software Solutions Services
 * ============================================
 * 
 * This script handles:
 * - Real-time form validation with disabled submit button
 * - reCAPTCHA v3 integration (invisible, score-based)
 * - Data collection from all form fields
 * - Generation of unique submission ID
 * - Saving data to localStorage
 * - Redirecting to subscribe.html
 * 
 * No external dependencies - vanilla JavaScript only
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  
  const CONFIG = {
    formId: 'businessDetailsForm',
    submitButtonId: 'submitButton',
    storageKey: 'sss_submission_data',
    redirectUrl: './subscribe.html',
    recaptchaSiteKey: '6Let8lQsAAAAAKdI_oGL3i-8QRKVDtN-SA8AKPSX'
  };

  // ============================================
  // RECAPTCHA v3 FUNCTIONS
  // ============================================

  /**
   * Get reCAPTCHA v3 token for form submission
   * v3 is invisible - no user interaction required
   * @returns {Promise<string>} The reCAPTCHA token
   */
  function getRecaptchaToken() {
    return new Promise((resolve, reject) => {
      if (typeof grecaptcha === 'undefined') {
        console.warn('[reCAPTCHA] grecaptcha not loaded, skipping');
        resolve('');
        return;
      }
      
      grecaptcha.ready(function() {
        grecaptcha.execute(CONFIG.recaptchaSiteKey, { action: 'submit_form' })
          .then(function(token) {
            resolve(token);
          })
          .catch(function(error) {
            console.error('[reCAPTCHA] Failed to get token:', error);
            resolve(''); // Don't block form submission
          });
      });
    });
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Generate a unique submission ID
   * Format: SSS-YYYYMMDD-XXXXXX (where X is alphanumeric)
   * @returns {string} Unique submission ID
   */
  function generateSubmissionId() {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
                    String(now.getMonth() + 1).padStart(2, '0') +
                    String(now.getDate()).padStart(2, '0');
    
    // Generate random alphanumeric string
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomStr = '';
    for (let i = 0; i < 6; i++) {
      randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return `SSS-${dateStr}-${randomStr}`;
  }

  /**
   * Get current timestamp in ISO format
   * @returns {string} ISO timestamp
   */
  function getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Collect all form data including inputs, selects, textareas, checkboxes, radios
   * @param {HTMLFormElement} form - The form element
   * @returns {Object} Collected form data
   */
  function collectFormData(form) {
    const formData = {};
    const elements = form.elements;

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const name = element.name;
      
      // Skip elements without names or submit buttons
      if (!name || element.type === 'submit' || element.type === 'button') {
        continue;
      }

      switch (element.type) {
        case 'checkbox':
          // Handle checkbox groups (multiple checkboxes with same name)
          if (!formData[name]) {
            formData[name] = [];
          }
          if (element.checked) {
            formData[name].push(element.value);
          }
          break;

        case 'radio':
          // Only capture the selected radio value
          if (element.checked) {
            formData[name] = element.value;
          }
          break;

        case 'file':
          // For file inputs, capture metadata only (not the actual file)
          if (element.files && element.files.length > 0) {
            const file = element.files[0];
            formData[name] = {
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
              lastModified: file.lastModified
            };
          } else {
            formData[name] = null;
          }
          break;

        case 'select-multiple':
          // Handle multi-select dropdowns
          formData[name] = [];
          for (let j = 0; j < element.options.length; j++) {
            if (element.options[j].selected) {
              formData[name].push(element.options[j].value);
            }
          }
          break;

        default:
          // Text, email, tel, url, textarea, select-one, etc.
          formData[name] = element.value.trim();
          break;
      }
    }

    // Ensure checkbox arrays exist even if none selected
    const checkboxNames = ['mainGoals'];
    checkboxNames.forEach(name => {
      if (!formData[name]) {
        formData[name] = [];
      }
    });

    return formData;
  }

  /**
   * Check if all required fields are filled (for enabling submit button)
   * @param {HTMLFormElement} form - The form element
   * @returns {boolean} True if all required fields are filled
   */
  function areAllRequiredFieldsFilled(form) {
    const requiredFields = form.querySelectorAll('[required]');
    
    for (let i = 0; i < requiredFields.length; i++) {
      const field = requiredFields[i];
      
      switch (field.type) {
        case 'checkbox':
          // For required checkboxes (like terms), must be checked
          if (!field.checked) {
            return false;
          }
          break;
        case 'radio':
          // Check if any radio in the group is selected
          const radioGroup = form.querySelectorAll(`input[name="${field.name}"]`);
          const anySelected = Array.from(radioGroup).some(radio => radio.checked);
          if (!anySelected) {
            return false;
          }
          break;
        default:
          // Text, email, tel, textarea, select, etc.
          if (!field.value || field.value.trim() === '') {
            return false;
          }
          break;
      }
    }

    // Check if at least one main goal is selected
    const mainGoals = form.querySelectorAll('input[name="mainGoals"]:checked');
    if (mainGoals.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update the submit button state based on form validity
   * Note: reCAPTCHA v3 is invisible, so no checkbox to check
   */
  function updateSubmitButtonState() {
    const form = document.getElementById(CONFIG.formId);
    const submitButton = document.getElementById(CONFIG.submitButtonId);
    
    if (!form || !submitButton) return;

    const allFieldsFilled = areAllRequiredFieldsFilled(form);
    // v3 reCAPTCHA has no checkbox - enable submit when fields are filled
    const isValid = allFieldsFilled;

    if (isValid) {
      submitButton.disabled = false;
      submitButton.classList.remove('button-disabled');
    } else {
      submitButton.disabled = true;
      submitButton.classList.add('button-disabled');
    }
  }

  /**
   * Validate required fields (double-check on submit)
   * @param {HTMLFormElement} form - The form element
   * @returns {Object} Validation result with isValid flag and errors array
   */
  function validateForm(form) {
    const errors = [];
    const requiredFields = form.querySelectorAll('[required]');

    requiredFields.forEach(field => {
      const name = field.name || field.id;
      let isValid = true;

      switch (field.type) {
        case 'checkbox':
          isValid = field.checked;
          break;
        case 'radio':
          // Check if any radio in the group is selected
          const radioGroup = form.querySelectorAll(`input[name="${field.name}"]`);
          isValid = Array.from(radioGroup).some(radio => radio.checked);
          break;
        default:
          isValid = field.value.trim() !== '';
          break;
      }

      if (!isValid) {
        errors.push({
          field: name,
          message: `${getFieldLabel(field)} is required`
        });
        field.classList.add('field-error');
      } else {
        field.classList.remove('field-error');
      }
    });

    // Check if at least one main goal is selected
    const mainGoals = form.querySelectorAll('input[name="mainGoals"]:checked');
    if (mainGoals.length === 0) {
      errors.push({
        field: 'mainGoals',
        message: 'Please select at least one main goal'
      });
    }

    // Note: reCAPTCHA v3 is invisible and token is obtained on submit
    // No pre-validation checkbox check needed

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Get the label text for a field
   * @param {HTMLElement} field - The form field element
   * @returns {string} Label text
   */
  function getFieldLabel(field) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) {
      return label.textContent.replace('*', '').trim();
    }
    return field.name || field.id || 'Field';
  }

  /**
   * Display validation errors to the user (fallback if button somehow clicked)
   * @param {Array} errors - Array of error objects
   */
  function displayErrors(errors) {
    // Remove existing error messages
    const existingErrors = document.querySelectorAll('.form-error-message');
    existingErrors.forEach(el => el.remove());

    if (errors.length > 0) {
      // Create error summary
      const errorSummary = document.createElement('div');
      errorSummary.className = 'form-error-message';
      errorSummary.style.cssText = `
        background-color: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.5);
        border-radius: 0.5rem;
        padding: 1rem;
        margin-bottom: 1.5rem;
        color: #fca5a5;
      `;

      const errorTitle = document.createElement('p');
      errorTitle.style.fontWeight = '600';
      errorTitle.style.marginBottom = '0.5rem';
      errorTitle.textContent = 'Please fix the following errors:';
      errorSummary.appendChild(errorTitle);

      const errorList = document.createElement('ul');
      errorList.style.cssText = 'list-style: disc; padding-left: 1.25rem; margin: 0;';
      
      errors.forEach(error => {
        const li = document.createElement('li');
        li.textContent = error.message;
        errorList.appendChild(li);
      });

      errorSummary.appendChild(errorList);

      // Insert at top of form
      const form = document.getElementById(CONFIG.formId);
      form.insertBefore(errorSummary, form.firstChild);

      // Scroll to error summary
      errorSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Save submission data to localStorage
   * @param {Object} data - The submission data to save
   */
  function saveToLocalStorage(data) {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
      return false;
    }
  }

  /**
   * Redirect to the subscribe page
   */
  function redirectToSubscribe() {
    window.location.href = CONFIG.redirectUrl;
  }

  // ============================================
  // FORM INITIALIZATION
  // ============================================

  /**
   * Initialize the form handler
   */
  function initForm() {
    const form = document.getElementById(CONFIG.formId);
    const submitButton = document.getElementById(CONFIG.submitButtonId);
    
    if (!form) {
      console.error('Form not found:', CONFIG.formId);
      return;
    }

    // Ensure button is disabled initially
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.classList.add('button-disabled');
    }

    // Handle custom CTA toggle
    const ctaRadios = form.querySelectorAll('input[name="ctaType"]');
    const customCtaGroup = document.getElementById('customCtaGroup');
    
    ctaRadios.forEach(radio => {
      radio.addEventListener('change', function() {
        if (this.value === 'custom') {
          customCtaGroup.style.display = 'block';
        } else {
          customCtaGroup.style.display = 'none';
        }
      });
    });

    // Add real-time validation - update button state on any input change
    const allInputs = form.querySelectorAll('input, select, textarea');
    allInputs.forEach(input => {
      // Listen to multiple events to catch all changes
      ['input', 'change', 'blur'].forEach(eventType => {
        input.addEventListener(eventType, function() {
          updateSubmitButtonState();
        });
      });
    });

    // Form submission handler
    form.addEventListener('submit', async function(event) {
      // Prevent default form submission
      event.preventDefault();

      // Double-check: If button is disabled, don't submit
      if (submitButton && submitButton.disabled) {
        console.warn('Form submitted while button was disabled - blocked');
        return;
      }

      // Validate the form (double-check)
      const validation = validateForm(form);

      if (!validation.isValid) {
        displayErrors(validation.errors);
        // Re-disable button as a safety measure
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.classList.add('button-disabled');
        }
        return;
      }

      // Clear any previous errors
      displayErrors([]);

      // Disable submit button while processing
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Processing...';
      }

      // Collect all form data
      const formData = collectFormData(form);

      // Get reCAPTCHA v3 token (invisible, runs in background)
      try {
        const recaptchaToken = await getRecaptchaToken();
        if (recaptchaToken) {
          formData.recaptchaToken = recaptchaToken;
          console.log('[reCAPTCHA v3] Token obtained');
        }
      } catch (recaptchaError) {
        console.warn('[reCAPTCHA v3] Failed to get token:', recaptchaError);
        // Continue anyway - server will handle missing token
      }

      // Generate submission ID and timestamp
      const submissionId = generateSubmissionId();
      const submittedAt = getTimestamp();

      // Create the complete submission object
      const submission = {
        submissionId: submissionId,
        submittedAt: submittedAt,
        formData: formData,
        metadata: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          referrer: document.referrer || 'direct'
        }
      };

      // Save to localStorage
      const saved = saveToLocalStorage(submission);

      if (saved) {
        console.log('Submission saved successfully:', submissionId);
        
        // Redirect to subscribe page
        redirectToSubscribe();
      } else {
        // Show error if localStorage fails
        displayErrors([{
          field: 'general',
          message: 'Failed to save your submission. Please try again or contact support.'
        }]);
        
        // Re-enable submit button
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Submit Details and Subscribe';
        }
      }
    });

    // Initial button state check
    updateSubmitButtonState();

    console.log('Form handler initialized with real-time validation');
  }

  // ============================================
  // DOM READY
  // ============================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForm);
  } else {
    initForm();
  }

})();
