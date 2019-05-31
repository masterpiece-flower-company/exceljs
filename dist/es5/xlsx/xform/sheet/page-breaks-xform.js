'use strict';

var utils = require('../../../utils/utils');

var BaseXform = require('../base-xform');

var PageBreaksXform = module.exports = function () {};

utils.inherits(PageBreaksXform, BaseXform, {
  get tag() {
    return 'brk';
  },

  render: function render(xmlStream, model) {
    xmlStream.leafNode('brk', model);
  },
  parseOpen: function parseOpen(node) {
    if (node.name === 'brk') {
      this.model = node.attributes.ref;
      return true;
    }

    return false;
  },
  parseText: function parseText() {},
  parseClose: function parseClose() {
    return false;
  }
});
//# sourceMappingURL=page-breaks-xform.js.map
