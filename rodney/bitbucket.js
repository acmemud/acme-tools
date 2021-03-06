/**
 * The BitBucket adapter for issue tracking and pull requests.
 *
 * @module bitbucket
 * @requires  module:gitcore
 */

var Gitcore = require('./gitcore.js');
var gitcore = Gitcore('bobalu', 'Not2easy');

exports.query = query;

/**
 * Return the BitBucket API url for the specified path.
 *
 * @param  {string} path the path of the API request
 * @return {string}      the full URL for API request
 */
function apiUrl(path) {
  return "https://bitbucket.org/api/2.0/repositories/bobalu/eotl-mudlib" +
         path;
}

/**
 * Query the BitBucket API.
 *
 * @param  {string}   query        the BitBucket query string
 * @param  {function} onFulfilled  query result will be passed to this
 *                                 callback
 * @param  {function} onRejected   errors will be passed to this callback
 * @return {boolean}               true for valid query string, false
 *                                 otherwise
 */
function query(query, onFulfilled, onRejected) {
  var onFulfilledWrapper = function(data) {
    gitcore.teardownCache();
    onFulfilled(data);
  };
  var onRejectedWrapper = function(data) {
    gitcore.teardownCache();
    onRejected(data);
  };

  var runQuery = getRunQuery(query, onFulfilledWrapper, onRejectedWrapper);
  if (runQuery) {
    gitcore.setupCache();
    runQuery();
    return true;
  }
  else {
    return false;
  }
}

/**
 * Get query runner function for specified query and callbacks.
 *
 * @param  {string}   query        the query to run
 * @param  {function} onFulfilled  query result will be passed to this
 *                                 callback
 * @param  {function} onRejected   errors will be passed to this callback
 * @return {function}              the function which will execute the query
 */
function getRunQuery(query, onFulfilled, onRejected) {
  var runQuery;

  if (query == "pullRequests") {
    runQuery = function() {
      getPullRequests(onFulfilled, onRejected);
    };
  } else if (query.substring(0, 12) == "pullRequest.") {
    var pos = query.indexOf(".", 12);
    if (pos < 0) {
      var id = query.substring(12);
      runQuery = function() {
        getPullRequest(onFulfilled, onRejected, id);
      };
    } else {
      var id = query.substring(12, pos);
      var pos2 = query.indexOf(".", pos + 1);
      if (pos2 >= 0) {
        var op = query.substring(pos + 1, pos2)
        if (op == "review") {
          var file = query.substring(pos2 + 1);
          runQuery = function() {
            getPullReqReview(onFulfilled, onRejected, id, file);
          }
        }
      }
    }
  }

  return runQuery;
}

/**
 * Execute API requests for pull request list query.
 *
 * @param  {function} onFulfilled query result will be passed to this callback
 * @param  {function} onRejected  errors will be passed to this callback
 */
function getPullRequests(onFulfilled, onRejected) {
  gitcore.apiRequest(onFulfilled,
                     onRejected,
                     apiUrl('/pullrequests'),
                     marshallPullRequests);
}

/**
 * Execute API requests for single pull request query.
 *
 * @param  {function} onFulfilled query result will be passed to this callback
 * @param  {function} onRejected  errors will be passed to this callback
 * @param  {number}   id          the pull request id to get
 */
function getPullRequest(onFulfilled, onRejected, id) {
  var filesRequest = function(data) {
    var filesFulfilled = function(filesData) {
      for (var attr in filesData) { data[attr] = filesData[attr]; }
      data["changed_files"] = data.files.length;
      onFulfilled(data);
    };
    gitcore.apiRequest(filesFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/diff'),
                       marshallFiles);
  }
  var commentsRequest = function(data) {
    var commentsFulfilled = function(commentsData) {
      data.comments = commentsData;
      filesRequest(data);
    };
    gitcore.apiRequest(commentsFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/comments'),
                       marshallComments);
  }
  var commitsRequest = function(data) {
    var commitsFulfilled = function(commitsData) {
      data.commits = commitsData.length;
      commentsRequest(data);
    };
    gitcore.apiRequest(commitsFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/commits'),
                       marshallCommits);
  }
  gitcore.apiRequest(commitsRequest,
                     onRejected,
                     apiUrl('/pullrequests/' + id),
                     marshallPullRequest);
}

/**
 * Execute the API requests for a code review on pull request file.
 *
 * @param  {function} onFulfilled query result will be passed to this callback
 * @param  {function} onRejected  errors will be passed to this callback
 * @param  {number}   id          the pull request id
 * @param  {mixed}    file        the file to review, either the string path
 *                                of the file or the numerical index in the
 *                                file list
 */
function getPullReqReview(onFulfilled, onRejected, id, file) {
  var reviewCommentsRequest = function(data) {
    var reviewCommentsFulfilled = function(reviewCommentsData) {
      var comments = { };
      reviewCommentsData.forEach(function(x) {
        var from = x.from;
        var to = x.to;
        delete x.from;
        delete x.to;
        var pos;
        if (from && (from in data.from_positions)) {
          pos = data.from_positions[from];
        } else if (to && (to in data.to_positions)) {
          pos = data.to_positions[to];
        }

        if (pos != undefined) {
          pos -= 3;
          if (!(pos in comments)) {
            comments[pos] = [ ];
          }
          comments[pos].push(x);
        } else {
          log.warn("Unable to translate review comment position");
        }
      });
      data.comments = comments;
      delete data.from_positions;
      delete data.to_positions;
      onFulfilled(data);
    }
    var marshallReviewCommentsWrapper = function(buffer) {
      return marshallReviewComments(buffer, data.path);
    }
    gitcore.apiRequest(reviewCommentsFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/comments'),
                       marshallReviewCommentsWrapper);
  }
  var diffRequest = function(data) {
    var diffFulfilled = function(diffData) {
      for (var attr in diffData) { data[attr] = diffData[attr]; }
      reviewCommentsRequest(data);
    };
    var marshallDiffWrapper = function(buffer) {
      return marshallDiff(buffer, data.path);
    }
    gitcore.apiRequest(diffFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/diff'),
                       marshallDiffWrapper);
  }
  var filesRequest = function(data) {
    var filesFulfilled = function(filesData) {
      var fileIndex = -1;
      var tmp = parseInt(file, 10);
      if (file == tmp) {
        if ((tmp >= 0) && (tmp < filesData.files.length)) {
          file = filesData.files[tmp];
          fileIndex = tmp;
        }
      } else {
        fileIndex = filesData.files.indexOf(file);
      }
      if (fileIndex < 0) {
        onRejected(new Error("invalid file for diff"));
      } else {
        data.path = file;
        data.file = fileIndex;
        diffRequest(data);
      }
    };
    gitcore.apiRequest(filesFulfilled,
                       onRejected,
                       apiUrl('/pullrequests/' + id + '/diff'),
                       marshallFiles);
  }
  gitcore.apiRequest(filesRequest,
                     onRejected,
                     apiUrl('/pullrequests/' + id),
                     marshallPullRequest);
}

/**
 * Marshall the result of the pull requests API call into standard structure.
 *
 * @param  {object} buffer the result of the API call
 * @return {object}        an object containing information about the pull
 *                         requests
 */
function marshallPullRequests(buffer) {
  var data = JSON.parse(buffer);
  var out = data.values.map(function(x) {
    return {
              "id": x.id,
           "state": x.state.toLowerCase(),
           "title": x.title,
     "description": x.description,
      "created_at": marshallTimestamp(x.created_on),
      "updated_at": marshallTimestamp(x.updated_on),
       "closed_at": ((x.merge_commit != null)
                     ? marshallTimestamp(x.merge_commit.date)
                     : null),
          "author": x.author.username,
    }
  });
  return out;
}

/**
 * Marshall the result of the single pull request API call into standard
 * structure.
 *
 * @param  {object} buffer the result of the API call
 * @return {object}        an object containing information about the pull
 *                         request
 */
function marshallPullRequest(buffer) {
  var data = JSON.parse(buffer);
  var out = {
               "id": data.id,
            "state": data.state.toLowerCase(),
            "title": data.title,
      "description": data.description,
       "created_at": marshallTimestamp(data.created_on),
       "updated_at": marshallTimestamp(data.updated_on),
     "merge_commit": data.merge_commit,
        "closed_at": ((data.merge_commit != null)
                      ? marshallTimestamp(data.merge_commit.date)
                      : null),
           "author": data.author.username,
           "merged": (data.merge_commit != null),
  };
  return out;
}

/**
 * Marshall the result of the pull request commits API call into standard
 * structure.
 *
 * @param  {object} buffer the result of the API call
 * @return {array}         an array of objects containing information about
 *                         each commit
 */
function marshallCommits(buffer) {
  var data = JSON.parse(buffer);
  var out = data.values.map(function(x) {
    return {
            "user": x.author.user.username,
         "message": x.message,
       "timestamp": marshallTimestamp(x.date),
    }
  });
  return out;
}

/**
 * Marshall the result of the pull request comments API call into standard
 * structure.
 *
 * @param  {object} buffer the result of the API call
 * @return {array}         an array of objects containing information about
 *                         each comment
 */
function marshallComments(buffer) {
  var data = JSON.parse(buffer);
  data = data.values.filter(function(x) { return !("inline" in x) });
  var out = data.map(function(x) {
    return {
            "user": x.user.username,
         "message": x.content.raw,
      "created_at": marshallTimestamp(x.created_on),
      "updated_at": marshallTimestamp(x.updated_on),
    }
  });
  return out;
}

/**
 * Marshall the result of the pull request diff API call into standard
 * structure.
 *
 * @param  {object} buffer the result of the API call
 * @return {array}         an array of filenames affected by the pull request
 */
function marshallFiles(buffer) {
  var additions = 0;
  var deletions = 0;
  var files = [ ];
  var i = 0;
  while (i < buffer.length) {
    var j = buffer.indexOf("\n", i);
    if (j == -1) { j = buffer.length; }
    var line = buffer.substring(i, j);
    var tag = line.substring(0, 1);
    var leading = line.substring(0, 6);
    if (tag == "+") {
      if (leading == "+++ b/") {
        files.push(line.substr(6));
      } else {
        additions++;
      }
    } else if(tag == "-") {
      if (leading != "--- a/") {
        deletions++;
      }
    }
    i = j + 1;
  }
  return {
        "files": files,
    "additions": additions,
    "deletions": deletions,
  };
}

/**
 * Marshall the result of a unified diff into single diff for specified file.
 *
 * @param  {object} buffer the result of the API call
 * @param  {string} path   the path of the file to extract from diff
 * @return {object}        an object containing the file's diff
 */
function marshallDiff(buffer, path) {
  var out = { };
  var i = 0;
  var lines = null;
  var from_positions = { };
  var to_positions = { };
  var from_pos = -1;
  var to_pos = -1
  while (i < buffer.length) {
    var j = buffer.indexOf("\n", i);
    if (j == -1) { j = buffer.length; }
    var line = buffer.substring(i, j);
    if (lines) {
      var token = "diff --git ";
      if (line.substring(0, token.length) == token) {
        break;
      } else {
        lines.push(line);
        if (line.substring(0, 2) == '@@') {
          var matches = line.match(/^@@ \-(\d+),\d+ \+(\d+),\d+ @@/);
          if (matches) {
            from_pos = parseInt(matches[1], 10);
            to_pos = parseInt(matches[2], 10);
            from_positions[from_pos++] = lines.legnth;
            to_positions[to_pos++] = lines.length;
          } else {
            console.warn("malformed diff block header, file " + path +
                         ", line " + lines.length);
          }
        } else {
          from_positions[from_pos++] = lines.length;
          to_positions[to_pos++] = lines.length;
        }
      }
    } else {
      var token = "diff --git a/" + path + " b/" + path;
      if (line.substring(0, token.length) == token) {
        lines = [ line ];
      }
    }
    i = j + 1;
  }
  out = {
              "diff": lines,
    "from_positions": from_positions,
      "to_positions": to_positions,
  };
  return out;
}

/**
 * Marshall the result of a review comments API call into standard structure.
 *
 * @param  {object} buffer the result of the API call
 * @param  {string} path   the path of the file for which to get review
 *                         comments
 * @return {object}        an object with diff position (line number) as
 *                         properties and comment info objects as values
 */
function marshallReviewComments(buffer, path) {
  var data = JSON.parse(buffer);
  data = data.values.filter(function(x) {
    return ("inline" in x) && (x.inline.path == path);
  });
  var out = data.map(function(x) {
    return {
            "user": x.user.username,
         "message": x.content.raw,
      "created_at": marshallTimestamp(x.created_on),
      "updated_at": marshallTimestamp(x.updated_on),
            "from": x.inline.from,
              "to": x.inline.to,
    }
  });
  return out;
}

/**
 * Marshall a timestamp back into unixtime.
 *
 * @param  {string} timestamp a timestamp from API call
 * @return {number}           the unixtime of that timestamp
 */
function marshallTimestamp(timestamp) {
  return Math.floor(Date.parse(timestamp) / 1000);
}

