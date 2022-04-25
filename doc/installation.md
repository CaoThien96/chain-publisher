# Installation

```bash
# STEP 1. 
#
# Make sure that local machine has read permission to Github repository at
# https://github.com/launchzone/chain-publisher by SSH key. 

# STEP 2.
#
# Install package via SSH.
#   * <tag> Specific tag.
npm install git+ssh://git@github.com:launchzone/chain-publisher.git#<tag>

# STEP 3.
# 
# Test. 
node -e 'require("chain-publisher")' && echo 'ok'
```
