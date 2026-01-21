/**
 * ============================================
 * FORM.JS - Business Details Form Handler
 * Software Solutions Services
 * ============================================
 * 
 * This script handles:
 * - Form validation
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
    storageKey: 'sss_submission_data',
    redirectUrl: './subscribe.html'
  };

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
   * Validate required fields
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
   * Display validation errors to the user
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
    
    if (!form) {
      console.error('Form not found:', CONFIG.formId);
      return;
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

    // Form submission handler
    form.addEventListener('submit', function(event) {
      // Prevent default form submission
      event.preventDefault();

      // Validate the form
      const validation = validateForm(form);

      if (!validation.isValid) {
        displayErrors(validation.errors);
        return;
      }

      // Clear any previous errors
      displayErrors([]);

      // Collect all form data
      const formData = collectFormData(form);

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
      }
    });

    // Add real-time validation feedback
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.addEventListener('blur', function() {
        if (this.required && !this.value.trim()) {
          this.classList.add('field-error');
        } else {
          this.classList.remove('field-error');
        }
      });

      input.addEventListener('input', function() {
        if (this.classList.contains('field-error') && this.value.trim()) {
          this.classList.remove('field-error');
        }
      });
    });

    console.log('Form handler initialized');
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
