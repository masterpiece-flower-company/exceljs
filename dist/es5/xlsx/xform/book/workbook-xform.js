'use strict';

var _ = require('../../../utils/under-dash');

var utils = require('../../../utils/utils');

var colCache = require('../../../utils/col-cache');

var XmlStream = require('../../../utils/xml-stream');

var BaseXform = require('../base-xform');

var StaticXform = require('../static-xform');

var ListXform = require('../list-xform');

var DefinedNameXform = require('./defined-name-xform');

var SheetXform = require('./sheet-xform');

var WorkbookViewXform = require('./workbook-view-xform');

var WorkbookPropertiesXform = require('./workbook-properties-xform');

var WorkbookXform = module.exports = function () {
  this.map = {
    fileVersion: WorkbookXform.STATIC_XFORMS.fileVersion,
    workbookPr: new WorkbookPropertiesXform(),
    bookViews: new ListXform({
      tag: 'bookViews',
      count: false,
      childXform: new WorkbookViewXform()
    }),
    sheets: new ListXform({
      tag: 'sheets',
      count: false,
      childXform: new SheetXform()
    }),
    definedNames: new ListXform({
      tag: 'definedNames',
      count: false,
      childXform: new DefinedNameXform()
    }),
    calcPr: WorkbookXform.STATIC_XFORMS.calcPr
  };
};

utils.inherits(WorkbookXform, BaseXform, {
  WORKBOOK_ATTRIBUTES: {
    xmlns: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'mc:Ignorable': 'x15',
    'xmlns:x15': 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main'
  },
  STATIC_XFORMS: {
    fileVersion: new StaticXform({
      tag: 'fileVersion',
      $: {
        appName: 'xl',
        lastEdited: 5,
        lowestEdited: 5,
        rupBuild: 9303
      }
    }),
    calcPr: new StaticXform({
      tag: 'calcPr',
      $: {
        calcId: 171027
      }
    })
  }
}, {
  prepare: function prepare(model) {
    model.sheets = model.worksheets; // collate all the print areas from all of the sheets and add them to the defined names

    var printAreas = [];
    var index = 0; // sheets is sparse array - calc index manually

    model.sheets.forEach(function (sheet) {
      if (sheet.pageSetup && sheet.pageSetup.printArea) {
        var definedName = {
          name: '_xlnm.Print_Area',
          ranges: ["".concat(sheet.name, "!").concat(sheet.pageSetup.printArea)],
          localSheetId: index
        };
        printAreas.push(definedName);
      }

      if (sheet.pageSetup && (sheet.pageSetup.printTitlesRow || sheet.pageSetup.printTitlesColumn)) {
        var ranges = [];

        if (sheet.pageSetup.printTitlesColumn) {
          var titlesColumns = sheet.pageSetup.printTitlesColumn.split(':');
          ranges.push("'".concat(sheet.name, "'!$").concat(titlesColumns[0], ":$").concat(titlesColumns[1]));
        }

        if (sheet.pageSetup.printTitlesRow) {
          var titlesRows = sheet.pageSetup.printTitlesRow.split(':');
          ranges.push("'".concat(sheet.name, "'!$").concat(titlesRows[0], ":$").concat(titlesRows[1]));
        }

        var _definedName = {
          name: '_xlnm.Print_Titles',
          ranges: ranges,
          localSheetId: index
        };
        printAreas.push(_definedName);
      }

      index++;
    });

    if (printAreas.length) {
      model.definedNames = model.definedNames.concat(printAreas);
    }

    model.media && model.media.forEach(function (medium, i) {
      // assign name
      medium.name = medium.type + (i + 1);
    });
  },
  render: function render(xmlStream, model) {
    xmlStream.openXml(XmlStream.StdDocAttributes);
    xmlStream.openNode('workbook', WorkbookXform.WORKBOOK_ATTRIBUTES);
    this.map.fileVersion.render(xmlStream);
    this.map.workbookPr.render(xmlStream, model.properties);
    this.map.bookViews.render(xmlStream, model.views);
    this.map.sheets.render(xmlStream, model.sheets);
    this.map.definedNames.render(xmlStream, model.definedNames);
    this.map.calcPr.render(xmlStream);
    xmlStream.closeNode();
  },
  parseOpen: function parseOpen(node) {
    if (this.parser) {
      this.parser.parseOpen(node);
      return true;
    }

    switch (node.name) {
      case 'workbook':
        return true;

      default:
        this.parser = this.map[node.name];

        if (this.parser) {
          this.parser.parseOpen(node);
        }

        return true;
    }
  },
  parseText: function parseText(text) {
    if (this.parser) {
      this.parser.parseText(text);
    }
  },
  parseClose: function parseClose(name) {
    if (this.parser) {
      if (!this.parser.parseClose(name)) {
        this.parser = undefined;
      }

      return true;
    }

    switch (name) {
      case 'workbook':
        this.model = {
          sheets: this.map.sheets.model,
          properties: this.map.workbookPr.model || {},
          views: this.map.bookViews.model
        };

        if (this.map.definedNames.model) {
          this.model.definedNames = this.map.definedNames.model;
        }

        return false;

      default:
        // not quite sure how we get here!
        return true;
    }
  },
  reconcile: function reconcile(model) {
    var rels = (model.workbookRels || []).reduce(function (map, rel) {
      map[rel.Id] = rel;
      return map;
    }, {}); // reconcile sheet ids, rIds and names

    var worksheets = [];
    var worksheet;
    var index = 0;
    (model.sheets || []).forEach(function (sheet) {
      var rel = rels[sheet.rId];

      if (!rel) {
        return;
      }

      worksheet = model.worksheetHash["xl/".concat(rel.Target)]; // If there are "chartsheets" in the file, rel.Target will
      // come out as chartsheets/sheet1.xml or similar here, and
      // that won't be in model.worksheetHash.
      // As we don't have the infrastructure to support chartsheets,
      // we will ignore them for now:

      if (worksheet) {
        worksheet.name = sheet.name;
        worksheet.id = sheet.id;
        worksheet.state = sheet.state;
        worksheets[index++] = worksheet;
      }
    }); // reconcile print areas

    var definedNames = [];

    _.each(model.definedNames, function (definedName) {
      if (definedName.name === '_xlnm.Print_Area') {
        worksheet = worksheets[definedName.localSheetId];

        if (worksheet) {
          if (!worksheet.pageSetup) {
            worksheet.pageSetup = {};
          }

          var range = colCache.decodeEx(definedName.ranges[0]);
          worksheet.pageSetup.printArea = range.dimensions;
        }
      } else if (definedName.name === '_xlnm.Print_Titles') {
        worksheet = worksheets[definedName.localSheetId];

        if (worksheet) {
          if (!worksheet.pageSetup) {
            worksheet.pageSetup = {};
          }

          var rangeString = definedName.ranges.join(',');
          var rowRangeRegex = /\$\d+:\$\d+/;
          var rowRangeMatches = rangeString.match(rowRangeRegex);

          if (rowRangeMatches && rowRangeMatches.length) {
            worksheet.pageSetup.printTitlesRow = rowRangeMatches[0];
          }

          var columnRangeRegex = /\$[A-Z]+:\$[A-Z]+/;
          var columnRangeMatches = rangeString.match(columnRangeRegex);

          if (columnRangeMatches && columnRangeMatches.length) {
            worksheet.pageSetup.printTitlesColumn = columnRangeMatches[0];
          }
        }
      } else {
        definedNames.push(definedName);
      }
    });

    model.definedNames = definedNames; // used by sheets to build their image models

    model.media.forEach(function (media, i) {
      media.index = i;
    });
  }
});
//# sourceMappingURL=workbook-xform.js.map
